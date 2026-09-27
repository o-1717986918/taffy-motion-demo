import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";

const baseUrl = process.env.TAFFY_BASE_URL ?? "http://127.0.0.1:5173";
const edgePath = process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const powershell = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const vcClientExe = process.env.TAFFY_VCCLIENT_EXE;
let browser;

const waitForOffline = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch("http://127.0.0.1:18888/api/voice-changer-manager/information", { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("VCClient 在 10 秒内没有释放 18888 端口。");
};

try {
  if (!vcClientExe) throw new Error("请将 TAFFY_VCCLIENT_EXE 设置为本机 VCClient main.exe 的完整路径后再运行此端到端脚本。");
  execFileSync(powershell, ["-NoProfile", "-Command", [
    `$target = '${vcClientExe}'`,
    "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
    "Get-Process -Name 'voice-changer-native-client' -ErrorAction SilentlyContinue | Stop-Process -Force"
  ].join("; ")], { stdio: "ignore" });
  await waitForOffline();

  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem("taffy.voice.settings", JSON.stringify({
      inputDeviceId: 14,
      outputDeviceId: 9,
      modelSlotIndex: 168,
      pitch: 12,
      indexRatio: 0.35,
      protect: 0.25,
      chunkSize: 48,
      inputGain: 1,
      outputGain: 0.75,
      denoiseLevel: "balanced"
    }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("server responded with a status of 502")) errors.push(message.text());
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "变声器" }).click();
  await page.getByRole("button", { name: "启动本机变声服务" }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "启动本机变声服务" }).click();
  const drawer = page.getByRole("complementary", { name: "塔菲变声链路" });
  await drawer.getByText("VOICE LIVE").waitFor({ timeout: 180_000 });
  await new Promise((done) => setTimeout(done, 5_000));

  const manager = await fetch("http://127.0.0.1:18888/api/voice-changer-manager/information", { signal: AbortSignal.timeout(10_000) }).then((response) => response.json());
  const configuration = await fetch("http://127.0.0.1:18888/api/configuration-manager/configuration", { signal: AbortSignal.timeout(10_000) }).then((response) => response.json());
  if (!manager.local_voice_changer_interface_active) throw new Error("冷启动后音频线程没有保持活动。");
  const slot = manager.voice_changer_information?.pipeline_info?.slot_info;
  if (slot?.chunk_sec !== 0.128 || slot?.index_ratio !== 0.35) throw new Error("冷启动没有应用低延迟槽位参数。");
  if (configuration.extra_frame_sec !== 0.05 || configuration.crossfade_sec !== 0.03 || configuration.sola_search_frame_sec !== 0.008) throw new Error("冷启动没有应用低延迟缓冲参数。");
  if (configuration.audio_output_device_index === 9) throw new Error("冷启动仍使用失效的 DirectSound 输出 9。");
  if (configuration.audio_input_device_sample_rate !== configuration.audio_output_device_sample_rate) throw new Error("冷启动选择了不同采样率的输入输出设备。");
  if (errors.length) throw new Error(`浏览器错误：${errors.join(" | ")}`);
  console.log(JSON.stringify({
    ok: true,
    startedOnlyFromFrontend: true,
    active: manager.local_voice_changer_interface_active,
    slot: manager.voice_changer_information?.slot_index,
    input: configuration.audio_input_device_index,
    output: configuration.audio_output_device_index,
    sampleRate: configuration.audio_input_device_sample_rate,
    noiseGate: configuration.noise_gate,
    chunkSec: slot?.chunk_sec,
    indexRatio: slot?.index_ratio,
    extraFrameSec: configuration.extra_frame_sec,
    crossfadeSec: configuration.crossfade_sec,
    solaSearchFrameSec: configuration.sola_search_frame_sec
  }, null, 2));
} finally {
  await browser?.close();
}
