export interface VoiceAudioDevice {
  kind: "audioinput" | "audiooutput";
  index: number;
  name: string;
  hostAPI: string;
  sampleRate?: number;
}

export interface VoiceModelSlot {
  slotIndex: number | string;
  voiceChangerType: string;
  name: string;
  description?: string;
  credit?: string;
  termsOfUseUrl?: string;
  modelFile?: string;
  indexFile?: string;
  isOnnx?: boolean;
}

export interface VoiceServerInfo {
  apiVersion?: "v1" | "v2";
  status: string;
  voiceChangerType?: string;
  serverAudioStated: number;
  enableServerAudio: number;
  serverAudioSampleRate: number;
  serverInputDeviceId: number;
  serverOutputDeviceId: number;
  serverMonitorDeviceId: number;
  serverReadChunkSize: number;
  serverInputAudioGain: number;
  serverOutputAudioGain: number;
  modelSlotIndex: number | string;
  tran: number;
  indexRatio: number;
  protect: number;
  f0Detector?: string;
  modelSlots: VoiceModelSlot[];
  serverAudioInputDevices: VoiceAudioDevice[];
  serverAudioOutputDevices: VoiceAudioDevice[];
  gpus?: Array<{ id: number; name: string; memory: number }>;
}

export interface VoiceStartOptions {
  inputDeviceId: number;
  outputDeviceId: number;
  modelSlotIndex: number | string;
  pitch: number;
  indexRatio: number;
  protect: number;
  chunkSize: number;
  inputGain: number;
  outputGain: number;
  denoiseLevel: VoiceDenoiseLevel;
}

export type VoiceDenoiseLevel = "off" | "light" | "balanced" | "strong";

export interface VoiceDenoiseProfile {
  noiseGate: number;
  highPassEnabled: boolean;
  highPassCutoff: number;
  lowPassEnabled: boolean;
  lowPassCutoff: number;
}

export interface VoiceLatencyProfile {
  extraFrameSec: number;
  crossfadeSec: number;
  solaSearchFrameSec: number;
}

export function getVoiceLatencyProfile(chunkSize: number): VoiceLatencyProfile {
  if (chunkSize <= 48) {
    return { extraFrameSec: 0.05, crossfadeSec: 0.03, solaSearchFrameSec: 0.008 };
  }
  if (chunkSize <= 64) {
    return { extraFrameSec: 0.06, crossfadeSec: 0.035, solaSearchFrameSec: 0.01 };
  }
  return { extraFrameSec: 0.08, crossfadeSec: 0.05, solaSearchFrameSec: 0.012 };
}

export const VOICE_DENOISE_PROFILES: Record<VoiceDenoiseLevel, VoiceDenoiseProfile> = {
  off: {
    noiseGate: -100,
    highPassEnabled: false,
    highPassCutoff: 80,
    lowPassEnabled: false,
    lowPassCutoff: 14000
  },
  light: {
    noiseGate: -60,
    highPassEnabled: true,
    highPassCutoff: 70,
    lowPassEnabled: true,
    lowPassCutoff: 14000
  },
  balanced: {
    noiseGate: -52,
    highPassEnabled: true,
    highPassCutoff: 85,
    lowPassEnabled: true,
    lowPassCutoff: 12000
  },
  strong: {
    noiseGate: -45,
    highPassEnabled: true,
    highPassCutoff: 100,
    lowPassEnabled: true,
    lowPassCutoff: 10000
  }
};

export interface PreparedVoiceModelAsset {
  name: string;
  bytes: number;
  sha256: string;
  url: string;
}

export interface PreparedVoiceModelManifest {
  schemaVersion: 1;
  displayName: string;
  format: "RVC";
  version: string;
  suppliedByUser: true;
  sourceArchive: { name: string; sha256: string };
  model: PreparedVoiceModelAsset;
  index: PreparedVoiceModelAsset;
  recommended: Pick<VoiceStartOptions, "pitch" | "indexRatio" | "protect" | "chunkSize">;
}

export interface VoiceImportProgress {
  phase: "download" | "verify" | "upload" | "load" | "complete";
  label: string;
  percent: number;
}

export type VoiceConnectionState = "offline" | "checking" | "ready" | "live" | "error";

type FetchLike = typeof fetch;

export const DEFAULT_VOICE_ENDPOINT = "http://127.0.0.1:18888";

export function normalizeVoiceEndpoint(value: string): string {
  const parsed = new URL(value.trim());
  const host = parsed.hostname.toLowerCase();
  if (!(["127.0.0.1", "localhost"].includes(host))) {
    throw new Error("为保护原声音频，变声后端仅允许连接本机地址。");
  }
  if (!(["http:", "https:"].includes(parsed.protocol))) {
    throw new Error("后端地址必须使用 http 或 https。");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("后端地址不能包含凭据、查询参数或片段。");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
}

function asFinite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeInfo(raw: Partial<VoiceServerInfo>): VoiceServerInfo {
  return {
    apiVersion: raw.apiVersion ?? "v1",
    status: typeof raw.status === "string" ? raw.status : "ok",
    voiceChangerType: typeof raw.voiceChangerType === "string" ? raw.voiceChangerType : undefined,
    serverAudioStated: asFinite(raw.serverAudioStated, 0),
    enableServerAudio: asFinite(raw.enableServerAudio, 0),
    serverAudioSampleRate: asFinite(raw.serverAudioSampleRate, 48000),
    serverInputDeviceId: asFinite(raw.serverInputDeviceId, -1),
    serverOutputDeviceId: asFinite(raw.serverOutputDeviceId, -1),
    serverMonitorDeviceId: asFinite(raw.serverMonitorDeviceId, -1),
    serverReadChunkSize: asFinite(raw.serverReadChunkSize, 128),
    serverInputAudioGain: asFinite(raw.serverInputAudioGain, 1),
    serverOutputAudioGain: asFinite(raw.serverOutputAudioGain, 1),
    modelSlotIndex: raw.modelSlotIndex ?? 0,
    tran: asFinite(raw.tran, 0),
    indexRatio: asFinite(raw.indexRatio, 0),
    protect: asFinite(raw.protect, 0.5),
    f0Detector: typeof raw.f0Detector === "string" ? raw.f0Detector : undefined,
    modelSlots: Array.isArray(raw.modelSlots) ? raw.modelSlots : [],
    serverAudioInputDevices: Array.isArray(raw.serverAudioInputDevices) ? raw.serverAudioInputDevices : [],
    serverAudioOutputDevices: Array.isArray(raw.serverAudioOutputDevices) ? raw.serverAudioOutputDevices : [],
    gpus: Array.isArray(raw.gpus) ? raw.gpus : []
  };
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asBooleanNumber(value: unknown): number {
  return value === true || Number(value) === 1 ? 1 : 0;
}

function normalizeV2Device(raw: JsonRecord, fallbackKind: VoiceAudioDevice["kind"]): VoiceAudioDevice {
  return {
    kind: raw.kind === "audiooutput" ? "audiooutput" : raw.kind === "audioinput" ? "audioinput" : fallbackKind,
    index: asFinite(raw.index, -1),
    name: typeof raw.name === "string" ? raw.name : `Device ${String(raw.index ?? "")}`,
    hostAPI: typeof raw.host_api === "string" ? raw.host_api : "Unknown",
    sampleRate: asFinite(raw.default_samplerate, 48000)
  };
}

function normalizeV2Slot(raw: JsonRecord): VoiceModelSlot | null {
  if (typeof raw.voice_changer_type !== "string" || !raw.voice_changer_type) return null;
  return {
    slotIndex: asFinite(raw.slot_index, -1),
    voiceChangerType: raw.voice_changer_type,
    name: typeof raw.name === "string" && raw.name ? raw.name : `Slot ${String(raw.slot_index ?? "")}`,
    description: typeof raw.description === "string" ? raw.description : undefined,
    credit: typeof raw.credit === "string" ? raw.credit : undefined,
    termsOfUseUrl: typeof raw.terms_of_use_url === "string" ? raw.terms_of_use_url : undefined,
    modelFile: typeof raw.model_file === "string" ? raw.model_file : undefined,
    indexFile: typeof raw.index_file === "string" ? raw.index_file : undefined,
    isOnnx: raw.is_onnx === true
  };
}

function normalizeV2Info(
  managerValue: unknown,
  configurationValue: unknown,
  inputValue: unknown,
  outputValue: unknown,
  slotValue: unknown,
  gpuValue: unknown
): VoiceServerInfo {
  const manager = asRecord(managerValue);
  const information = asRecord(manager.voice_changer_information);
  const pipeline = asRecord(information.pipeline_info);
  const activeSlot = asRecord(pipeline.slot_info);
  const configuration = asRecord(configurationValue);
  const modelSlots = asRecordArray(slotValue).map(normalizeV2Slot).filter((slot): slot is VoiceModelSlot => slot !== null);
  const chunkSec = asFinite(activeSlot.chunk_sec ?? information.chunk_sec, 128 * 128 / 48000);
  const inputDevices = asRecordArray(inputValue).map((device) => normalizeV2Device(device, "audioinput"));
  const outputDevices = asRecordArray(outputValue).map((device) => normalizeV2Device(device, "audiooutput"));
  return {
    apiVersion: "v2",
    status: "ok",
    voiceChangerType: typeof information.voice_changer_type === "string" ? information.voice_changer_type : undefined,
    serverAudioStated: asBooleanNumber(manager.local_voice_changer_interface_active),
    enableServerAudio: configuration.voice_changer_input_mode === "server" ? 1 : 0,
    serverAudioSampleRate: asFinite(configuration.input_sample_rate, 48000),
    serverInputDeviceId: asFinite(configuration.audio_input_device_index, -1),
    serverOutputDeviceId: asFinite(configuration.audio_output_device_index, -1),
    serverMonitorDeviceId: asFinite(configuration.audio_monitor_device_index, -1),
    serverReadChunkSize: Math.max(1, Math.round(chunkSec * 48000 / 128)),
    serverInputAudioGain: asFinite(configuration.audio_input_device_gain, 1),
    serverOutputAudioGain: asFinite(configuration.audio_output_device_gain, 1),
    modelSlotIndex: asFinite(information.slot_index ?? configuration.current_slot_index, 0),
    tran: asFinite(activeSlot.pitch_shift, 0),
    indexRatio: asFinite(activeSlot.index_ratio, 0),
    protect: asFinite(activeSlot.protect_ratio, 0.5),
    f0Detector: typeof information.pitch_estimator_type === "string" ? information.pitch_estimator_type : undefined,
    modelSlots,
    serverAudioInputDevices: inputDevices,
    serverAudioOutputDevices: outputDevices,
    gpus: asRecordArray(gpuValue).map((gpu) => ({
      id: asFinite(gpu.device_id_int, -1),
      name: typeof gpu.name === "string" ? gpu.name : "Unknown GPU",
      memory: asFinite(gpu.adapter_ram, 0)
    }))
  };
}

const PREPARED_MODEL_PREFIX = "/__taffy_voice_model/";

function isSafeModelAsset(value: unknown, extension: RegExp): value is PreparedVoiceModelAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<PreparedVoiceModelAsset>;
  return typeof asset.name === "string"
    && /^[\w.-]+$/.test(asset.name)
    && extension.test(asset.name)
    && typeof asset.bytes === "number"
    && Number.isSafeInteger(asset.bytes)
    && asset.bytes > 0
    && typeof asset.sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(asset.sha256)
    && typeof asset.url === "string"
    && asset.url.startsWith(PREPARED_MODEL_PREFIX)
    && !asset.url.includes("..");
}

export function normalizePreparedVoiceModel(raw: unknown): PreparedVoiceModelManifest {
  if (!raw || typeof raw !== "object") throw new Error("本机音色清单格式无效。");
  const manifest = raw as Partial<PreparedVoiceModelManifest>;
  if (manifest.schemaVersion !== 1 || manifest.format !== "RVC" || manifest.suppliedByUser !== true) {
    throw new Error("本机音色清单不是受支持的 RVC 用户模型。");
  }
  if (typeof manifest.displayName !== "string" || !manifest.displayName.trim()) throw new Error("本机音色缺少名称。");
  if (typeof manifest.version !== "string" || !manifest.version.trim()) throw new Error("本机音色缺少版本信息。");
  if (!manifest.sourceArchive || typeof manifest.sourceArchive.name !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.sourceArchive.sha256 ?? "")) {
    throw new Error("本机音色缺少来源校验信息。");
  }
  if (!isSafeModelAsset(manifest.model, /\.(pth|onnx)$/i) || !isSafeModelAsset(manifest.index, /\.(index|bin)$/i)) {
    throw new Error("本机音色文件名、地址或哈希无效。");
  }
  const recommended = manifest.recommended;
  if (!recommended || ![recommended.pitch, recommended.indexRatio, recommended.protect, recommended.chunkSize].every(Number.isFinite)) {
    throw new Error("本机音色缺少推荐参数。");
  }
  return manifest as PreparedVoiceModelManifest;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export class VoiceChangerController {
  private endpoint: string;
  private apiVersion: "v1" | "v2" | null = null;

  constructor(endpoint = DEFAULT_VOICE_ENDPOINT, private readonly request: FetchLike = fetch.bind(globalThis)) {
    this.endpoint = normalizeVoiceEndpoint(endpoint);
  }

  setEndpoint(value: string): string {
    const endpoint = normalizeVoiceEndpoint(value);
    if (endpoint !== this.endpoint) this.apiVersion = null;
    this.endpoint = endpoint;
    return this.endpoint;
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  private backendUrl(path: string): string {
    if (typeof window !== "undefined") {
      const target = new URL(this.endpoint);
      const pageHost = window.location.hostname.toLowerCase();
      const localPage = Boolean(window.taffyDesktop?.isDesktop) || (
        (pageHost === "127.0.0.1" || pageHost === "localhost")
        && (window.location.port === "5173" || window.location.port === "4173")
      );
      const defaultBackend = ["127.0.0.1", "localhost"].includes(target.hostname.toLowerCase())
        && target.port === "18888"
        && (target.pathname === "/" || target.pathname === "");
      if (localPage && defaultBackend) return `/__vcclient_proxy${path}`;
    }
    return `${this.endpoint}${path}`;
  }

  private async requestWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    if (init.signal) return this.request(url, init);
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.request(url, { ...init, signal: controller.signal });
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  private async requestV2(path: string, init: RequestInit = { method: "GET" }): Promise<unknown> {
    const response = await this.requestWithTimeout(this.backendUrl(path), {
      ...init,
      headers: { Accept: "application/json", ...init.headers }
    }, 30_000);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`VCClient v2 请求失败：HTTP ${response.status}${detail ? ` · ${detail}` : ""}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) as unknown : null;
  }

  private async probeV1(): Promise<VoiceServerInfo> {
    const response = await this.requestWithTimeout(this.backendUrl("/info"), {
      method: "GET",
      headers: { Accept: "application/json" }
    }, 10_000);
    if (!response.ok) throw new Error(`变声后端返回 HTTP ${response.status}。`);
    return normalizeInfo({ ...(await response.json() as Partial<VoiceServerInfo>), apiVersion: "v1" });
  }

  private async probeV2(managerResponse?: Response): Promise<VoiceServerInfo> {
    const managerPromise = managerResponse
      ? Promise.resolve(managerResponse)
      : this.requestWithTimeout(this.backendUrl("/api/voice-changer-manager/information"), { method: "GET", headers: { Accept: "application/json" } }, 10_000);
    const responses = await Promise.all([
      managerPromise,
      this.requestWithTimeout(this.backendUrl("/api/configuration-manager/configuration"), { method: "GET", headers: { Accept: "application/json" } }, 10_000),
      this.requestWithTimeout(this.backendUrl("/api/audio-device-manager/input_devices"), { method: "GET", headers: { Accept: "application/json" } }, 10_000),
      this.requestWithTimeout(this.backendUrl("/api/audio-device-manager/output_devices"), { method: "GET", headers: { Accept: "application/json" } }, 10_000),
      this.requestWithTimeout(this.backendUrl("/api/slot-manager/slots"), { method: "GET", headers: { Accept: "application/json" } }, 10_000),
      this.requestWithTimeout(this.backendUrl("/api/gpu-device-manager/devices"), { method: "GET", headers: { Accept: "application/json" } }, 10_000)
    ]);
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`变声后端返回 HTTP ${failed.status}。`);
    const [manager, configuration, input, output, slots, gpus] = await Promise.all(responses.map((response) => response.json() as Promise<unknown>));
    return normalizeV2Info(manager, configuration, input, output, slots, gpus);
  }

  async probe(): Promise<VoiceServerInfo> {
    if (this.apiVersion === "v1") return this.probeV1();
    if (this.apiVersion === "v2") return this.probeV2();

    const v2Response = await this.requestWithTimeout(this.backendUrl("/api/voice-changer-manager/information"), {
      method: "GET",
      headers: { Accept: "application/json" }
    }, 10_000);
    if (v2Response.ok) {
      this.apiVersion = "v2";
      return this.probeV2(v2Response);
    }
    const info = await this.probeV1();
    this.apiVersion = "v1";
    return info;
  }

  async startRuntime(): Promise<void> {
    const endpoint = new URL(this.endpoint);
    if (endpoint.port !== "18888" || (endpoint.pathname !== "/" && endpoint.pathname !== "")) {
      throw new Error("前端一键启动仅支持默认本机 VCClient 地址 http://127.0.0.1:18888。");
    }
    const response = await this.requestWithTimeout("/__taffy_voice_runtime/start", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Taffy-Local-Control": "1"
      },
      body: "{}"
    }, 180_000);
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (typeof parsed.error === "string") detail = parsed.error;
      } catch {
        // 保留服务返回的纯文本错误。
      }
      throw new Error(`启动本机 VCClient 失败：HTTP ${response.status}${detail ? ` · ${detail}` : ""}`);
    }
  }

  async performance(): Promise<number[]> {
    if (this.apiVersion === "v2") return [];
    const response = await this.request(this.backendUrl("/performance"), {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return [];
    const value = await response.json() as unknown;
    return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
  }

  async discoverPreparedModel(): Promise<PreparedVoiceModelManifest | null> {
    const response = await this.request(`${PREPARED_MODEL_PREFIX}manifest`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`读取本机音色清单失败：HTTP ${response.status}。`);
    return normalizePreparedVoiceModel(await response.json() as unknown);
  }

  private async uploadPreparedAsset(
    asset: PreparedVoiceModelAsset,
    completedBefore: number,
    totalBytes: number,
    onProgress: (progress: VoiceImportProgress) => void
  ): Promise<void> {
    onProgress({ phase: "download", label: `读取 ${asset.name}`, percent: Math.round(completedBefore / totalBytes * 100) });
    const localResponse = await this.request(asset.url, { method: "GET", headers: { Accept: "application/octet-stream" } });
    if (!localResponse.ok) throw new Error(`读取 ${asset.name} 失败：HTTP ${localResponse.status}。`);
    const buffer = await localResponse.arrayBuffer();
    if (buffer.byteLength !== asset.bytes) throw new Error(`${asset.name} 大小与清单不符，已停止导入。`);

    onProgress({ phase: "verify", label: `校验 ${asset.name}`, percent: Math.round(completedBefore / totalBytes * 100) });
    const digest = await sha256Hex(buffer);
    if (digest.toLowerCase() !== asset.sha256.toLowerCase()) throw new Error(`${asset.name} 的 SHA-256 不匹配，已停止导入。`);

    const chunkSize = 1024 * 1024;
    const chunkCount = Math.ceil(buffer.byteLength / chunkSize);
    let uploaded = 0;
    for (let batchStart = 0; batchStart < chunkCount; batchStart += 6) {
      const requests: Promise<Response>[] = [];
      const batchEnd = Math.min(batchStart + 6, chunkCount);
      for (let index = batchStart; index < batchEnd; index += 1) {
        const chunk = buffer.slice(index * chunkSize, Math.min((index + 1) * chunkSize, buffer.byteLength));
        const body = new FormData();
        body.append("file", new Blob([chunk]), asset.name);
        if (this.apiVersion === "v2") {
          body.append("filename", asset.name);
          body.append("index", String(index));
        } else {
          body.append("filename", `${asset.name}_${index}`);
        }
        const uploadPath = this.apiVersion === "v2" ? "/api/uploader/upload_file_chunk" : "/upload_file";
        requests.push(this.request(this.backendUrl(uploadPath), { method: "POST", body }));
      }
      const responses = await Promise.all(requests);
      const failed = responses.find((response) => !response.ok);
      if (failed) throw new Error(`上传 ${asset.name} 失败：HTTP ${failed.status}。`);
      uploaded = Math.min(batchEnd * chunkSize, buffer.byteLength);
      onProgress({
        phase: "upload",
        label: `上传 ${asset.name}`,
        percent: Math.round((completedBefore + uploaded) / totalBytes * 100)
      });
    }

    const concatBody = this.apiVersion === "v2"
      ? new URLSearchParams({ filename: asset.name, filename_chunk_num: String(chunkCount) })
      : (() => {
          const body = new FormData();
          body.append("filename", asset.name);
          body.append("filenameChunkNum", String(chunkCount));
          return body;
        })();
    const concatPath = this.apiVersion === "v2" ? "/api/uploader/concat_uploaded_file_chunk" : "/concat_uploaded_file";
    const concatResponse = await this.request(this.backendUrl(concatPath), {
      method: "POST",
      headers: this.apiVersion === "v2" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      body: concatBody
    });
    if (!concatResponse.ok) throw new Error(`合并 ${asset.name} 失败：HTTP ${concatResponse.status}。`);
  }

  async importPreparedRvcModel(
    manifest: PreparedVoiceModelManifest,
    slot: number,
    onProgress: (progress: VoiceImportProgress) => void = () => undefined
  ): Promise<VoiceServerInfo> {
    const safeManifest = normalizePreparedVoiceModel(manifest);
    if (!Number.isSafeInteger(slot) || slot < 0 || slot > 169) throw new Error("模型槽位必须是 0–169 的整数。");
    await this.probe();
    const assets = [safeManifest.model, safeManifest.index];
    const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
    let completed = 0;
    for (const asset of assets) {
      await this.uploadPreparedAsset(asset, completed, totalBytes, onProgress);
      completed += asset.bytes;
    }

    onProgress({ phase: "load", label: `载入槽位 ${slot}`, percent: 99 });
    if (this.apiVersion === "v2") {
      await this.requestV2("/api/slot-manager/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot_index: slot,
          voice_changer_type: "RVC",
          name: safeManifest.displayName,
          model_file: safeManifest.model.name,
          index_file: safeManifest.index.name,
          embedder: "hubert_base_l12"
        })
      });

      if (/\.pth$/i.test(safeManifest.model.name)) {
        onProgress({ phase: "load", label: "转换 ONNX / DirectML", percent: 99 });
        try {
          await this.requestV2("/api/slot-manager/slots/operation/export_onnx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slot_index: slot })
          });
          await this.requestV2("/api/slot-manager/slots/operation/move_exported_onnx_model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dst: slot })
          });
        } catch (error) {
          console.warn("VCClient v2 无法转换 ONNX，将继续使用原始 RVC 权重。", error);
        }
      }

      const info = await this.probe();
      const loaded = info.modelSlots.some((modelSlot) => Number(modelSlot.slotIndex) === slot && modelSlot.voiceChangerType === "RVC");
      if (!loaded) throw new Error(`后端没有确认槽位 ${slot} 的 RVC 模型。`);
      onProgress({ phase: "complete", label: `${safeManifest.displayName} 已载入`, percent: 100 });
      return info;
    }

    const params = {
      voiceChangerType: "RVC",
      slot,
      isSampleMode: false,
      sampleId: null,
      files: [
        { name: safeManifest.model.name, kind: "rvcModel", dir: "" },
        { name: safeManifest.index.name, kind: "rvcIndex", dir: "" }
      ],
      params: {}
    };
    const body = new FormData();
    body.append("slot", String(slot));
    body.append("isHalf", "false");
    body.append("params", JSON.stringify(params));
    const response = await this.request(this.backendUrl("/load_model"), { method: "POST", body });
    if (!response.ok) throw new Error(`载入 RVC 模型失败：HTTP ${response.status}。`);

    const info = await this.probe();
    const loaded = info.modelSlots.some((modelSlot) => Number(modelSlot.slotIndex) === slot && modelSlot.voiceChangerType === "RVC");
    if (!loaded) throw new Error(`后端没有确认槽位 ${slot} 的 RVC 模型。`);
    onProgress({ phase: "complete", label: `${safeManifest.displayName} 已载入`, percent: 100 });
    return info;
  }

  async updateSetting(key: string, value: string | number): Promise<VoiceServerInfo> {
    const body = new FormData();
    body.append("key", key);
    body.append("val", String(value));
    const response = await this.request(this.backendUrl("/update_settings"), { method: "POST", body });
    if (!response.ok) throw new Error(`设置 ${key} 失败：HTTP ${response.status}。`);
    return normalizeInfo(await response.json() as Partial<VoiceServerInfo>);
  }

  async start(options: VoiceStartOptions): Promise<VoiceServerInfo> {
    if (options.inputDeviceId < 0 || options.outputDeviceId < 0) {
      throw new Error("请选择麦克风和扬声器。");
    }
    let info = await this.probe();
    const denoise = VOICE_DENOISE_PROFILES[options.denoiseLevel] ?? VOICE_DENOISE_PROFILES.balanced;
    const selectedModel = info.modelSlots.find((slot) => String(slot.slotIndex) === String(options.modelSlotIndex));
    if (!selectedModel) throw new Error("VCClient 尚未载入可用的 RVC 模型。");
    const selectedInput = info.serverAudioInputDevices.find((device) => device.index === options.inputDeviceId);
    const selectedOutput = info.serverAudioOutputDevices.find((device) => device.index === options.outputDeviceId);
    if (!selectedInput || !selectedOutput) throw new Error("所选音频设备已经失效，请刷新设备列表后重试。");
    if (selectedInput.hostAPI !== selectedOutput.hostAPI) {
      throw new Error(`麦克风使用 ${selectedInput.hostAPI}，扬声器使用 ${selectedOutput.hostAPI}；请选择相同音频接口的设备。`);
    }
    if (selectedInput.sampleRate && selectedOutput.sampleRate && selectedInput.sampleRate !== selectedOutput.sampleRate) {
      throw new Error(`麦克风为 ${selectedInput.sampleRate} Hz，扬声器为 ${selectedOutput.sampleRate} Hz；请选择相同采样率的设备。`);
    }

    if (this.apiVersion === "v2") {
      if (selectedModel.voiceChangerType !== "RVC") throw new Error("当前控制面板只支持启动 RVC 音色。");
      const slotIndex = Number(options.modelSlotIndex);
      const latency = getVoiceLatencyProfile(options.chunkSize);
      if (!Number.isSafeInteger(slotIndex) || slotIndex < 0) throw new Error("VCClient v2 模型槽位无效。");
      if (info.serverAudioStated === 1) {
        await this.requestV2("/api/voice-changer/operation/stop_server_device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "null"
        });
      }

      const rawSlot = asRecord(await this.requestV2(`/api/slot-manager/slots/${slotIndex}`));
      Object.assign(rawSlot, {
        pitch_shift: options.pitch,
        index_ratio: options.indexRatio,
        protect_ratio: options.protect,
        chunk_sec: Math.min(1, Math.max(0.1, options.chunkSize * 128 / 48000)),
        pitch_estimator: "rmvpe_onnx"
      });
      await this.requestV2(`/api/slot-manager/slots/${slotIndex}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rawSlot)
      });

      const configuration = asRecord(await this.requestV2("/api/configuration-manager/configuration"));
      const configuredGpu = asFinite(configuration.gpu_device_id_int, -1);
      const availableGpu = info.gpus?.find((gpu) => gpu.id >= 0)?.id ?? -1;
      Object.assign(configuration, {
        current_slot_index: slotIndex,
        voice_changer_input_mode: "client",
        audio_input_device_index: options.inputDeviceId,
        audio_output_device_index: options.outputDeviceId,
        audio_monitor_device_index: -1,
        audio_input_device_sample_rate: selectedInput.sampleRate ?? 48000,
        audio_output_device_sample_rate: selectedOutput.sampleRate ?? 48000,
        audio_monitor_device_sample_rate: -1,
        audio_input_device_gain: options.inputGain,
        audio_output_device_gain: options.outputGain,
        noise_gate: denoise.noiseGate,
        enable_high_pass_filter: denoise.highPassEnabled,
        high_pass_filter_cutoff: denoise.highPassCutoff,
        enable_low_pass_filter: denoise.lowPassEnabled,
        low_pass_filter_cutoff: denoise.lowPassCutoff,
        extra_frame_sec: latency.extraFrameSec,
        crossfade_sec: latency.crossfadeSec,
        sola_search_frame_sec: latency.solaSearchFrameSec,
        gpu_device_id_int: configuredGpu >= 0 ? configuredGpu : availableGpu,
        input_sample_rate: selectedInput.sampleRate ?? 48000,
        output_sample_rate: selectedOutput.sampleRate ?? 48000,
        monitor_sample_rate: 48000
      });
      await this.requestV2("/api/configuration-manager/configuration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configuration)
      });
      configuration.voice_changer_input_mode = "server";
      await this.requestV2("/api/configuration-manager/configuration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configuration)
      });
      await this.requestV2("/api/voice-changer/operation/start_server_device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null"
      });
      let stableReadings = 0;
      for (let attempt = 0; attempt < 9 && stableReadings < 3; attempt += 1) {
        info = await this.probe();
        const expectedDevices = info.serverInputDeviceId === options.inputDeviceId && info.serverOutputDeviceId === options.outputDeviceId;
        stableReadings = info.serverAudioStated === 1 && expectedDevices ? stableReadings + 1 : 0;
        if (stableReadings < 3) await new Promise((done) => globalThis.setTimeout(done, 750));
      }
      if (stableReadings < 3) throw new Error("VCClient v2 未能稳定保持所选本机音频设备，请检查设备占用。 ");
      return info;
    }

    const settings: Array<[string, string | number]> = [
      ["serverAudioStated", 0],
      ["enableServerAudio", 1],
      ["serverInputDeviceId", options.inputDeviceId],
      ["serverOutputDeviceId", options.outputDeviceId],
      ["serverMonitorDeviceId", -1],
      ["serverAudioSampleRate", 48000],
      ["serverReadChunkSize", options.chunkSize],
      ["serverInputAudioGain", options.inputGain],
      ["serverOutputAudioGain", options.outputGain],
      ["noiseGate", denoise.noiseGate],
      ["modelSlotIndex", options.modelSlotIndex],
      ["tran", options.pitch],
      ["indexRatio", options.indexRatio],
      ["protect", options.protect],
      ["f0Detector", "rmvpe_onnx"],
      ["serverAudioStated", 1]
    ];
    for (const [key, value] of settings) info = await this.updateSetting(key, value);
    return info;
  }

  async stop(): Promise<VoiceServerInfo> {
    if (this.apiVersion === null) await this.probe();
    if (this.apiVersion === "v2") {
      await this.requestV2("/api/voice-changer/operation/stop_server_device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null"
      });
      return this.probe();
    }
    return this.updateSetting("serverAudioStated", 0);
  }
}
