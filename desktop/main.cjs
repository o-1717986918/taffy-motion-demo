const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { createReadStream, createWriteStream, existsSync, readFileSync, statSync } = require("node:fs");
const { createServer, request: httpRequest } = require("node:http");
const { extname, join, normalize, resolve, sep } = require("node:path");
const { buildVoiceStartupState } = require("./voice-startup.cjs");
const { loadVoiceSettings, saveVoiceSettings } = require("./voice-settings-store.cjs");

const APP_NAME = "塔菲动作与变声台";
const VC_PORT = Number(process.env.TAFFY_VOICE_PORT ?? 18888);
const VC_ORIGIN = `http://127.0.0.1:${VC_PORT}`;
if (process.env.TAFFY_USER_DATA_DIR) app.setPath("userData", resolve(process.env.TAFFY_USER_DATA_DIR));
const appRoot = app.getAppPath();
let localServer = null;
let mainWindow = null;
let voiceProcess = null;
let voiceStartInFlight = null;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".task", "application/octet-stream"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".pmx", "application/octet-stream"],
  [".onnx", "application/octet-stream"],
  [".index", "application/octet-stream"]
]);

function resourcePath(name) {
  return app.isPackaged ? join(process.resourcesPath, name) : null;
}

function rendererRoot() {
  return join(appRoot, "dist");
}

function avatarRoot() {
  return resourcePath("taffy-avatar")
    ?? process.env.TAFFY_AVATAR_MODEL_DIR
    ?? join(appRoot, "local-assets", "avatar");
}

function voiceRuntimeRoot() {
  return resourcePath("vcclient")
    ?? process.env.TAFFY_VCCLIENT_DIR
    ?? join(appRoot, "local-assets", "vcclient");
}

function manifestPath(name) {
  return join(appRoot, "desktop", name);
}

function voiceSettingsPath() {
  return join(app.getPath("userData"), "voice-settings.json");
}

function safeChildPath(root, relativePath) {
  const target = resolve(root, normalize(relativePath));
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return target === root || target.startsWith(prefix) ? target : null;
}

function applyLocalHeaders(response) {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, statusCode, value) {
  applyLocalHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function serveFile(request, response, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(response, 404, { error: "资源不存在。" });
    return;
  }
  applyLocalHeaders(response);
  const stats = statSync(filePath);
  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream");
  response.setHeader("Content-Length", String(stats.size));
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
}

function proxyVoiceRequest(request, response, upstreamPath) {
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port: VC_PORT,
    method: request.method,
    path: upstreamPath,
    headers: { ...request.headers, host: `127.0.0.1:${VC_PORT}`, connection: "close" },
    timeout: 180_000
  }, (upstreamResponse) => {
    applyLocalHeaders(response);
    response.statusCode = upstreamResponse.statusCode ?? 502;
    for (const [key, value] of Object.entries(upstreamResponse.headers)) {
      if (value !== undefined && !["connection", "transfer-encoding", "content-length"].includes(key)) response.setHeader(key, value);
    }
    upstreamResponse.pipe(response);
  });
  upstream.on("timeout", () => upstream.destroy(new Error("VCClient request timed out.")));
  upstream.on("error", (error) => {
    if (!response.headersSent) sendJson(response, 502, { error: `VCClient 不可用：${error.message}` });
    else response.destroy(error);
  });
  request.pipe(upstream);
}

async function fetchJson(path, options = {}, timeoutMs = 20_000) {
  const response = await fetch(`${VC_ORIGIN}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path}: HTTP ${response.status}${text ? ` · ${text}` : ""}`);
  return text ? JSON.parse(text) : null;
}

async function voiceApiReady() {
  try {
    const value = await fetchJson("/api/voice-changer-manager/information", {}, 3500);
    return Boolean(value?.voice_changer_information);
  } catch {
    return false;
  }
}

async function waitForVoiceApi(seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await voiceApiReady()) return;
    await new Promise((done) => setTimeout(done, 750));
  }
  throw new Error("内置 VCClient 在限定时间内没有就绪。");
}

function startVoiceProcess() {
  const root = voiceRuntimeRoot();
  const executable = join(root, "main.exe");
  if (!existsSync(executable)) throw new Error(`内置 VCClient 缺失：${executable}`);
  const logs = app.getPath("logs");
  const stdout = createWriteStream(join(logs, "vcclient.stdout.log"), { flags: "a" });
  const stderr = createWriteStream(join(logs, "vcclient.stderr.log"), { flags: "a" });
  voiceProcess = spawn(executable, [
    "cui", "--host=127.0.0.1", `--port=${VC_PORT}`,
    "--https=False", "--launch_client=False", "--no_cui=True"
  ], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  voiceProcess.stdout.pipe(stdout);
  voiceProcess.stderr.pipe(stderr);
  voiceProcess.once("exit", () => {
    stdout.end();
    stderr.end();
    voiceProcess = null;
  });
  voiceProcess.once("error", (error) => {
    stdout.end();
    stderr.end();
    voiceProcess = null;
    console.error("VCClient process error", error);
  });
}

async function configureVoice() {
  const voiceManifest = JSON.parse(readFileSync(manifestPath("voice-model-manifest.json"), "utf8"));
  const slotIndex = Number(voiceManifest.slotIndex ?? 168);
  const modelFile = voiceManifest.model?.name;
  if (!Number.isSafeInteger(slotIndex) || slotIndex < 0 || !modelFile || !voiceManifest.index?.name) {
    throw new Error("本机变声音色清单无效，请参考 desktop/voice-model-manifest.example.json。 ");
  }
  const [slot, configuration, inputs, outputs, gpus] = await Promise.all([
    fetchJson(`/api/slot-manager/slots/${slotIndex}`),
    fetchJson("/api/configuration-manager/configuration"),
    fetchJson("/api/audio-device-manager/input_devices"),
    fetchJson("/api/audio-device-manager/output_devices"),
    fetchJson("/api/gpu-device-manager/devices")
  ]);
  if (slot?.voice_changer_type !== "RVC" || String(slot.model_file ?? "").toLowerCase() !== String(modelFile).toLowerCase()) {
    throw new Error(`VCClient 槽位 ${slotIndex} 未找到清单指定的 RVC 音色 ${modelFile}。`);
  }

  const { input, output, gpu, configuration: nextConfiguration } = buildVoiceStartupState(configuration, inputs, outputs, gpus);
  await fetchJson("/api/configuration-manager/configuration", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextConfiguration)
  });

  const information = await fetchJson("/api/voice-changer-manager/information");
  if (!information?.local_voice_changer_interface_active) {
    await fetchJson("/api/voice-changer/operation/start_server_device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null"
    }, 90_000);
  }
  return { input: input.name, output: output.name, gpu: gpu?.name ?? "CPU" };
}

async function ensureVoiceBackend() {
  if (voiceStartInFlight) return voiceStartInFlight;
  voiceStartInFlight = (async () => {
    if (!(await voiceApiReady())) {
      startVoiceProcess();
      await waitForVoiceApi(120);
    }
    return configureVoice();
  })().finally(() => { voiceStartInFlight = null; });
  return voiceStartInFlight;
}

function createLocalServer() {
  const renderer = rendererRoot();
  const avatar = resolve(avatarRoot());
  const avatarManifest = manifestPath("avatar-manifest.json");
  const voiceManifestFile = manifestPath("voice-model-manifest.json");

  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname === "/__taffy_voice_runtime/start") {
        if (request.method !== "POST" || request.headers["x-taffy-local-control"] !== "1") {
          sendJson(response, 403, { error: "只允许桌面应用启动内置变声服务。" });
          return;
        }
        const result = await ensureVoiceBackend();
        sendJson(response, 200, { ok: true, ...result });
        return;
      }
      if (pathname.startsWith("/__vcclient_proxy/")) {
        proxyVoiceRequest(request, response, `${pathname.slice("/__vcclient_proxy".length)}${requestUrl.search}`);
        return;
      }
      if (pathname === "/__taffy_avatar/manifest.json") {
        serveFile(request, response, avatarManifest);
        return;
      }
      if (pathname.startsWith("/__taffy_avatar/files/")) {
        const relative = pathname.slice("/__taffy_avatar/files/".length);
        const filePath = safeChildPath(avatar, relative);
        if (!filePath) sendJson(response, 403, { error: "模型路径无效。" });
        else serveFile(request, response, filePath);
        return;
      }
      if (pathname === "/__taffy_voice_model/manifest") {
        serveFile(request, response, voiceManifest);
        return;
      }
      if (pathname === "/__taffy_voice_model/model") {
        const localVoiceManifest = JSON.parse(readFileSync(voiceManifestFile, "utf8"));
        serveFile(request, response, join(voiceRuntimeRoot(), "model_dir", String(localVoiceManifest.slotIndex ?? 168), localVoiceManifest.model.name));
        return;
      }
      if (pathname === "/__taffy_voice_model/index") {
        const localVoiceManifest = JSON.parse(readFileSync(voiceManifestFile, "utf8"));
        serveFile(request, response, join(voiceRuntimeRoot(), "model_dir", String(localVoiceManifest.slotIndex ?? 168), localVoiceManifest.index.name));
        return;
      }

      const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const candidate = safeChildPath(renderer, relative);
      if (candidate && existsSync(candidate) && statSync(candidate).isFile()) serveFile(request, response, candidate);
      else serveFile(request, response, join(renderer, "index.html"));
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function createWindow() {
  localServer = createLocalServer();
  await new Promise((done, fail) => {
    localServer.once("error", fail);
    localServer.listen(0, "127.0.0.1", done);
  });
  const address = localServer.address();
  if (!address || typeof address === "string") throw new Error("无法创建桌面本机服务。");
  const origin = `http://127.0.0.1:${address.port}`;

  const isOwnOrigin = (value) => {
    try { return new URL(value).origin === origin; } catch { return false; }
  };
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    isOwnOrigin(requestingOrigin) && ["media", "fullscreen"].includes(permission));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) =>
    callback(isOwnOrigin(webContents.getURL()) && ["media", "fullscreen"].includes(permission)));

  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: "#edf0f8",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  ipcMain.removeHandler("taffy:voice-settings:load");
  ipcMain.removeHandler("taffy:voice-settings:save");
  ipcMain.handle("taffy:voice-settings:load", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("不允许的声线配置读取请求。");
    return loadVoiceSettings(voiceSettingsPath());
  });
  ipcMain.handle("taffy:voice-settings:save", (event, settings) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("不允许的声线配置写入请求。");
    return saveVoiceSettings(voiceSettingsPath(), settings);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isOwnOrigin(url)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(origin);
}

function stopOwnedVoiceProcess() {
  if (!voiceProcess?.pid) return;
  try { spawnSync("taskkill.exe", ["/PID", String(voiceProcess.pid), "/T", "/F"], { windowsHide: true }); } catch { /* best effort */ }
  voiceProcess = null;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow).catch((error) => {
    console.error(error);
    app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    localServer?.close();
    stopOwnedVoiceProcess();
  });
}
