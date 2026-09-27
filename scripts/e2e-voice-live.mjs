import { chromium } from "@playwright/test";

const baseUrl = process.env.TAFFY_BASE_URL ?? "http://127.0.0.1:5173";
const edgePath = process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
let browser;

try {
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
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "变声器" }).click();
  const drawer = page.getByRole("complementary", { name: "塔菲变声链路" });
  await drawer.getByText("VOICE LIVE").waitFor({ timeout: 30_000 });

  const inputBefore = await page.getByLabel("麦克风输入").inputValue();
  const outputBefore = await page.getByLabel("扬声器输出").inputValue();
  if (outputBefore === "9") throw new Error("前端仍保留失效的 DirectSound 输出 9。");

  await page.getByRole("button", { name: "停止变声输出" }).click();
  await drawer.getByText("RVC READY").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "启动塔菲变声" }).click();
  await drawer.getByText("VOICE LIVE").waitFor({ timeout: 30_000 });
  await new Promise((done) => setTimeout(done, 5_000));

  let manager;
  let configuration;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    manager = await fetch("http://127.0.0.1:18888/api/voice-changer-manager/information", { signal: AbortSignal.timeout(10_000) }).then((response) => response.json());
    configuration = await fetch("http://127.0.0.1:18888/api/configuration-manager/configuration", { signal: AbortSignal.timeout(10_000) }).then((response) => response.json());
    if (manager.local_voice_changer_interface_active
      && String(configuration.audio_input_device_index) === inputBefore
      && String(configuration.audio_output_device_index) === outputBefore) break;
    await new Promise((done) => setTimeout(done, 750));
  }
  if (!manager?.local_voice_changer_interface_active) throw new Error("前端启动后 VCClient 音频线程没有保持活动。");
  if (String(configuration.audio_input_device_index) !== inputBefore || String(configuration.audio_output_device_index) !== outputBefore) throw new Error("热重启后没有保持前端选择的音频设备。");
  const slot = manager.voice_changer_information?.pipeline_info?.slot_info;
  if (slot?.chunk_sec !== 0.128 || slot?.index_ratio !== 0.35) throw new Error("低延迟槽位参数没有生效。");
  if (configuration.extra_frame_sec !== 0.05 || configuration.crossfade_sec !== 0.03 || configuration.sola_search_frame_sec !== 0.008) throw new Error("低延迟缓冲参数没有生效。");
  if (errors.length) throw new Error(`浏览器错误：${errors.join(" | ")}`);
  console.log(JSON.stringify({
    ok: true,
    staleSelectionCorrected: { input: inputBefore, output: outputBefore },
    active: manager.local_voice_changer_interface_active,
    slot: manager.voice_changer_information?.slot_index,
    configuredInput: configuration?.audio_input_device_index,
    configuredOutput: configuration?.audio_output_device_index,
    inputRate: configuration?.audio_input_device_sample_rate,
    outputRate: configuration?.audio_output_device_sample_rate,
    chunkSec: slot?.chunk_sec,
    extraFrameSec: configuration?.extra_frame_sec,
    crossfadeSec: configuration?.crossfade_sec,
    solaSearchFrameSec: configuration?.sola_search_frame_sec
  }, null, 2));
} finally {
  await browser?.close();
}
