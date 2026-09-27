import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.TAFFY_BASE_URL ?? "http://127.0.0.1:5173";
const edgePath = process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const modelDirectory = process.env.TAFFY_MODEL_DIR ?? resolve(process.cwd(), "local-assets", "avatar");
const artifactDirectory = resolve(process.cwd(), "../../work/taffy-e2e");
await mkdir(artifactDirectory, { recursive: true });

const serverOutput = [];
let server = null;
let browser = null;

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server && server.exitCode !== null) {
      throw new Error(`Vite 提前退出：\n${serverOutput.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 服务仍在启动。
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`等待 ${url} 超时。`);
}

const messages = [];
const failedResponses = [];
let capabilityAudit = "";

try {
  if (!process.env.TAFFY_BASE_URL) {
    server = spawn(process.execPath, [resolve(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--strictPort"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    server.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
    server.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));
  }
  await waitForServer(baseUrl);

  browser = await chromium.launch({
    executablePath: edgePath,
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, permissions: ["camera"] });
  const page = await context.newPage();
  await page.route("**/__vcclient_proxy/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/api/voice-changer-manager/information")) {
      await route.fulfill({ json: {
        local_voice_changer_interface_active: false,
        voice_changer_information: {
          slot_index: 3,
          voice_changer_type: "RVC",
          pitch_estimator_type: "rmvpe_onnx",
          pipeline_info: { slot_info: { slot_index: 3, voice_changer_type: "RVC", name: "Authorized Taffy", model_file: "taffy.onnx", is_onnx: true, chunk_sec: 0.2, pitch_shift: 12, index_ratio: 0.5, protect_ratio: 0.3 } }
        }
      } });
      return;
    }
    if (url.endsWith("/api/configuration-manager/configuration")) {
      await route.fulfill({ json: { current_slot_index: 3, voice_changer_input_mode: "server", audio_input_device_index: 1, audio_output_device_index: 2, audio_monitor_device_index: -1, input_sample_rate: 48000, audio_input_device_gain: 1, audio_output_device_gain: 1 } });
      return;
    }
    if (url.endsWith("/api/audio-device-manager/input_devices")) {
      await route.fulfill({ json: [{ kind: "audioinput", index: 1, name: "Studio Mic", host_api: "Windows WASAPI", default_samplerate: 48000 }] });
      return;
    }
    if (url.endsWith("/api/audio-device-manager/output_devices")) {
      await route.fulfill({ json: [{ kind: "audiooutput", index: 2, name: "Monitor Headphones", host_api: "Windows WASAPI", default_samplerate: 48000 }] });
      return;
    }
    if (url.endsWith("/api/slot-manager/slots")) {
      await route.fulfill({ json: [{ slot_index: 3, voice_changer_type: "RVC", name: "Authorized Taffy", model_file: "taffy.onnx", is_onnx: true }] });
      return;
    }
    if (url.endsWith("/api/gpu-device-manager/devices")) {
      await route.fulfill({ json: [{ name: "Mock GPU", device_id_int: 0, adapter_ram: 8_000_000_000 }] });
      return;
    }
    await route.fulfill({ json: null });
  });
  await page.route("http://127.0.0.1:18888/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/performance")) {
      await route.fulfill({ json: [42, 4, 8, 30] });
      return;
    }
    await route.fulfill({
      json: {
        status: "ok",
        voiceChangerType: "RVC",
        enableServerAudio: 0,
        serverAudioStated: 0,
        serverAudioSampleRate: 48000,
        serverInputDeviceId: 1,
        serverOutputDeviceId: 2,
        serverMonitorDeviceId: -1,
        serverReadChunkSize: 64,
        serverInputAudioGain: 1,
        serverOutputAudioGain: 1,
        modelSlotIndex: 3,
        tran: 12,
        indexRatio: 0.5,
        protect: 0.3,
        modelSlots: [{ slotIndex: 3, voiceChangerType: "RVC", name: "Authorized Taffy" }],
        serverAudioInputDevices: [{ kind: "audioinput", index: 1, name: "Studio Mic", hostAPI: "WASAPI" }],
        serverAudioOutputDevices: [{ kind: "audiooutput", index: 2, name: "Monitor Headphones", hostAPI: "WASAPI" }]
      }
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") messages.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => messages.push(`page: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "现实画面" }).waitFor();
  await page.getByRole("heading", { name: "虚拟形象" }).waitFor();
  await page.screenshot({ path: resolve(artifactDirectory, "01-empty-stage.png"), fullPage: true });

  await page.locator(".camera-panel .panel-empty .primary-action").click();
  try {
    await page.locator(".camera-panel .signal-pill").getByText("LIVE").waitFor({ timeout: 30000 });
  } catch (error) {
    await page.screenshot({ path: resolve(artifactDirectory, "camera-start-failure.png"), fullPage: true });
    const panelText = await page.locator(".camera-panel").innerText();
    throw new Error(`摄像头启动失败：\n${panelText}\n${messages.join("\n")}`, { cause: error });
  }

  await page.locator('input[type="file"]').setInputFiles(modelDirectory);
  await page.getByText("PMX READY").waitFor({ timeout: 120000 });
  await page.getByText("手腕方向", { exact: true }).waitFor();
  await page.getByText("独立手指弯曲", { exact: true }).waitFor();
  const audit = page.getByTestId("pmx-usage-audit");
  await audit.locator("summary").click();
  capabilityAudit = await audit.innerText();
  await page.getByRole("button", { name: "关闭侧栏" }).click();
  await page.getByRole("heading", { name: "模型能力" }).waitFor({ state: "hidden" });
  await page.getByRole("status").waitFor({ state: "hidden", timeout: 6000 });
  await page.screenshot({ path: resolve(artifactDirectory, "02-taffy-loaded.png"), fullPage: true });

  await page.getByRole("button", { name: "性能" }).click();
  await page.getByRole("heading", { name: "性能档位" }).waitFor();
  await page.screenshot({ path: resolve(artifactDirectory, "03-performance-drawer.png"), fullPage: true });

  await page.getByRole("button", { name: "关闭侧栏" }).click();
  await page.getByRole("button", { name: "变声器" }).click();
  await page.getByRole("heading", { name: "塔菲变声链路" }).waitFor();
  await page.getByRole("complementary", { name: "塔菲变声链路" }).getByText("RVC READY").waitFor();
  await page.getByLabel("麦克风输入").selectOption("1");
  await page.getByLabel("扬声器输出").selectOption("2");
  await page.getByLabel("麦克风主动降噪").selectOption("balanced");
  await page.screenshot({ path: resolve(artifactDirectory, "04-voice-changer-ready.png"), fullPage: true });

  if (messages.length || failedResponses.length) {
    throw new Error(`浏览器错误：\n${[...messages, ...failedResponses].join("\n")}`);
  }
  console.log(JSON.stringify({ ok: true, artifactDirectory, modelLoaded: true, capabilityAudit }, null, 2));
} finally {
  await browser?.close();
  server?.kill();
}
