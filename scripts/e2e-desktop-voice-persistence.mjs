import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executablePath = process.env.TAFFY_DESKTOP_EXE;
const voicePort = Number(process.env.TAFFY_E2E_VOICE_PORT ?? 18889);
const proxyPrefix = "/__vcclient_proxy";
const profileDirectory = await mkdtemp(join(tmpdir(), "taffy-desktop-e2e-"));

async function waitForVoiceStopped(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${voicePort}/api/voice-changer-manager/information`, { signal: AbortSignal.timeout(1000) });
    } catch {
      return;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("VCClient did not stop after the desktop app closed.");
}

async function openDesktop() {
  const desktop = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      TAFFY_USER_DATA_DIR: profileDirectory,
      TAFFY_VOICE_PORT: String(voicePort)
    },
    timeout: 180_000
  });
  const page = await desktop.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => document.querySelector(".voice-top-status")?.textContent?.includes("VOICE LIVE"), null, { timeout: 180_000 });
  return { desktop, page };
}

async function api(page, path, init = {}) {
  return page.evaluate(async ({ url, requestInit }) => {
    const response = await fetch(url, requestInit);
    const text = await response.text();
    if (!response.ok) throw new Error(`${requestInit.method ?? "GET"} ${url}: HTTP ${response.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }, { url: `${proxyPrefix}${path}`, requestInit: init });
}

const sentinelSlot = {
  pitch_shift: 7,
  index_ratio: 0.55,
  protect_ratio: 0.4,
  chunk_sec: 0.256
};
const expectedConfiguration = {
  audio_input_device_gain: 1.25,
  audio_output_device_gain: 1.5,
  noise_gate: -45,
  enable_high_pass_filter: true,
  high_pass_filter_cutoff: 100,
  enable_low_pass_filter: true,
  low_pass_filter_cutoff: 10000,
  extra_frame_sec: 0.08,
  crossfade_sec: 0.05,
  sola_search_frame_sec: 0.012
};
const jsonRequest = (value) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value)
});
const nullPost = { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" };
const nearlyEqual = (left, right) => Math.abs(Number(left) - Number(right)) < 0.000001;

let first;
let second;
let baselineSlot;
let baselineConfiguration;
try {
  if (!executablePath) throw new Error("请将 TAFFY_DESKTOP_EXE 设置为已打包桌面应用的完整路径后再运行此端到端脚本。");
  first = await openDesktop();
  baselineSlot = await api(first.page, "/api/slot-manager/slots/168");
  baselineConfiguration = await api(first.page, "/api/configuration-manager/configuration");
  const persistedSettings = {
    inputDeviceId: baselineConfiguration.audio_input_device_index,
    outputDeviceId: baselineConfiguration.audio_output_device_index,
    modelSlotIndex: 168,
    pitch: sentinelSlot.pitch_shift,
    indexRatio: sentinelSlot.index_ratio,
    protect: sentinelSlot.protect_ratio,
    chunkSize: 96,
    inputGain: expectedConfiguration.audio_input_device_gain,
    outputGain: expectedConfiguration.audio_output_device_gain,
    denoiseLevel: "strong"
  };
  await first.page.waitForTimeout(1000);
  await first.page.evaluate((settings) => window.taffyDesktop.saveVoiceSettings(settings), persistedSettings);
  await first.page.waitForTimeout(500);
  const diskRoundTrip = await first.page.evaluate(() => window.taffyDesktop.loadVoiceSettings());
  if (JSON.stringify(diskRoundTrip) !== JSON.stringify(persistedSettings)) {
    throw new Error(`Desktop settings did not round-trip: ${JSON.stringify(diskRoundTrip)}`);
  }
  await first.desktop.close();
  first = null;
  await waitForVoiceStopped();

  second = await openDesktop();
  await second.page.waitForFunction(async (expected) => {
    const actual = await window.taffyDesktop.loadVoiceSettings();
    return JSON.stringify(actual) === JSON.stringify(expected);
  }, persistedSettings, { timeout: 10_000 });
  const actualSlot = await api(second.page, "/api/slot-manager/slots/168");
  const actualConfiguration = await api(second.page, "/api/configuration-manager/configuration");
  const actualStoredSettings = await second.page.evaluate(() => window.taffyDesktop.loadVoiceSettings());
  const slotPreserved = Object.entries(sentinelSlot).every(([key, value]) => nearlyEqual(actualSlot[key], value));
  const configurationPreserved = Object.entries(expectedConfiguration).every(([key, value]) =>
    typeof value === "boolean" ? actualConfiguration[key] === value : nearlyEqual(actualConfiguration[key], value));
  const settingsPreserved = JSON.stringify(actualStoredSettings) === JSON.stringify(persistedSettings);
  if (!slotPreserved || !configurationPreserved || !settingsPreserved) {
    throw new Error(`Voice settings were overwritten: ${JSON.stringify({ actualSlot, actualConfiguration, actualStoredSettings })}`);
  }

  console.log(JSON.stringify({
    ok: true,
    executablePath,
    isolatedProfile: profileDirectory,
    voicePort,
    slotPreserved,
    configurationPreserved,
    settingsPreserved,
    checked: { ...persistedSettings, ...sentinelSlot, ...expectedConfiguration }
  }, null, 2));
} finally {
  const activePage = second?.page ?? first?.page;
  if (activePage && baselineSlot && baselineConfiguration) {
    await api(activePage, "/api/voice-changer/operation/stop_server_device", nullPost).catch(() => {});
    await api(activePage, "/api/slot-manager/slots/168", jsonRequest(baselineSlot)).catch(() => {});
    await api(activePage, "/api/configuration-manager/configuration", jsonRequest(baselineConfiguration)).catch(() => {});
  }
  if (first) await first.desktop.close().catch(() => {});
  if (second) await second.desktop.close().catch(() => {});
  await waitForVoiceStopped().catch(() => {});
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
