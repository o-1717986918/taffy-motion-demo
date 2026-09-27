import { describe, expect, it, vi } from "vitest";
import {
  getVoiceLatencyProfile,
  normalizePreparedVoiceModel,
  normalizeVoiceEndpoint,
  VoiceChangerController,
  type PreparedVoiceModelManifest,
  type VoiceServerInfo
} from "../src/voice/VoiceChangerController";

const serverInfo: VoiceServerInfo = {
  status: "ok",
  voiceChangerType: "RVC",
  serverAudioStated: 0,
  enableServerAudio: 0,
  serverAudioSampleRate: 48000,
  serverInputDeviceId: -1,
  serverOutputDeviceId: -1,
  serverMonitorDeviceId: -1,
  serverReadChunkSize: 128,
  serverInputAudioGain: 1,
  serverOutputAudioGain: 1,
  modelSlotIndex: 3,
  tran: 12,
  indexRatio: 0.5,
  protect: 0.3,
  f0Detector: "rmvpe_onnx",
  modelSlots: [{ slotIndex: 3, voiceChangerType: "RVC", name: "Authorized Taffy" }],
  serverAudioInputDevices: [{ kind: "audioinput", index: 1, name: "Mic", hostAPI: "WASAPI" }],
  serverAudioOutputDevices: [{ kind: "audiooutput", index: 2, name: "Speaker", hostAPI: "WASAPI" }],
  gpus: [{ id: 0, name: "GPU", memory: 8 }]
};

describe("VoiceChangerController", () => {
  it("为 48/64/96 块选择对应的 VCClient v2 延迟窗口", () => {
    expect(getVoiceLatencyProfile(48)).toEqual({ extraFrameSec: 0.05, crossfadeSec: 0.03, solaSearchFrameSec: 0.008 });
    expect(getVoiceLatencyProfile(64)).toEqual({ extraFrameSec: 0.06, crossfadeSec: 0.035, solaSearchFrameSec: 0.01 });
    expect(getVoiceLatencyProfile(96)).toEqual({ extraFrameSec: 0.08, crossfadeSec: 0.05, solaSearchFrameSec: 0.012 });
  });

  it("只允许规范化后的本机端点", () => {
    expect(normalizeVoiceEndpoint("http://localhost:18888/")).toBe("http://localhost:18888");
    expect(normalizeVoiceEndpoint("http://127.0.0.1:18888/api/")).toBe("http://127.0.0.1:18888/api");
    expect(() => normalizeVoiceEndpoint("https://example.com:18888")).toThrow("仅允许连接本机地址");
    expect(() => normalizeVoiceEndpoint("http://user:secret@localhost:18888")).toThrow("不能包含凭据");
  });

  it("通过同源本机桥接器启动 VCClient 运行时", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const controller = new VoiceChangerController(undefined, request as unknown as typeof fetch);
    await controller.startRuntime();
    expect(request).toHaveBeenCalledWith("/__taffy_voice_runtime/start", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-Taffy-Local-Control": "1" })
    }));
  });

  it("探测并规范化 VCClient 服务信息", async () => {
    const request = vi.fn(async (url: string | URL | Request) => String(url).includes("/api/voice-changer-manager/")
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify({ status: "ok", modelSlots: [] }), { status: 200 }));
    const controller = new VoiceChangerController(undefined, request as unknown as typeof fetch);
    const info = await controller.probe();
    expect(info.serverAudioSampleRate).toBe(48000);
    expect(info.serverAudioInputDevices).toEqual([]);
    expect(request).toHaveBeenLastCalledWith("http://127.0.0.1:18888/info", expect.objectContaining({ method: "GET" }));
  });

  it("先配置模型和设备，最后才启动服务端音频", async () => {
    const settings: Array<[string, string]> = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/api/voice-changer-manager/")) return new Response("not found", { status: 404 });
      if (String(url).endsWith("/info")) return new Response(JSON.stringify(serverInfo), { status: 200 });
      const body = init?.body as FormData;
      settings.push([String(body.get("key")), String(body.get("val"))]);
      const running = body.get("key") === "serverAudioStated" && body.get("val") === "1";
      return new Response(JSON.stringify({ ...serverInfo, serverAudioStated: running ? 1 : 0 }), { status: 200 });
    });
    const controller = new VoiceChangerController(undefined, request as unknown as typeof fetch);
    await controller.start({
      inputDeviceId: 1,
      outputDeviceId: 2,
      modelSlotIndex: 3,
      pitch: 12,
      indexRatio: 0.55,
      protect: 0.3,
      chunkSize: 64,
      inputGain: 1,
      outputGain: 0.75,
      denoiseLevel: "balanced"
    });

    expect(settings).toContainEqual(["enableServerAudio", "1"]);
    expect(settings).toContainEqual(["serverInputDeviceId", "1"]);
    expect(settings).toContainEqual(["serverOutputDeviceId", "2"]);
    expect(settings).toContainEqual(["modelSlotIndex", "3"]);
    expect(settings).toContainEqual(["noiseGate", "-52"]);
    expect(settings.at(-1)).toEqual(["serverAudioStated", "1"]);
  });

  it("在停止现有音频前拒绝混用不同主机接口的设备", async () => {
    const request = vi.fn(async (url: string | URL | Request) => String(url).includes("/api/voice-changer-manager/")
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify({
          ...serverInfo,
          serverAudioStated: 1,
          serverAudioOutputDevices: [{ kind: "audiooutput", index: 9, name: "Default Output", hostAPI: "Windows DirectSound", sampleRate: 44100 }]
        }), { status: 200 }));
    const controller = new VoiceChangerController(undefined, request as unknown as typeof fetch);
    await expect(controller.start({
      inputDeviceId: 1,
      outputDeviceId: 9,
      modelSlotIndex: 3,
      pitch: 12,
      indexRatio: 0.55,
      protect: 0.3,
      chunkSize: 64,
      inputGain: 1,
      outputGain: 0.75,
      denoiseLevel: "balanced"
    })).rejects.toThrow("请选择相同音频接口的设备");
    expect(request.mock.calls.some(([url]) => String(url).includes("/update_settings"))).toBe(false);
  });

  it("拒绝把预置模型地址指向外网", () => {
    expect(() => normalizePreparedVoiceModel({
      schemaVersion: 1,
      displayName: "Unsafe",
      format: "RVC",
      version: "v2",
      suppliedByUser: true,
      sourceArchive: { name: "unsafe.zip", sha256: "a".repeat(64) },
      model: { name: "model.pth", bytes: 1, sha256: "b".repeat(64), url: "https://example.com/model.pth" },
      index: { name: "model.index", bytes: 1, sha256: "c".repeat(64), url: "/__taffy_voice_model/index" },
      recommended: { pitch: 12, indexRatio: 0.5, protect: 0.3, chunkSize: 64 }
    })).toThrow("文件名、地址或哈希无效");
  });

  it("校验本机模型并按 VCClient 协议分块导入", async () => {
    const modelBytes = new TextEncoder().encode("safe-rvc-model");
    const indexBytes = new TextEncoder().encode("safe-faiss-index");
    const sha256 = async (bytes: Uint8Array) => {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)))
        .map((value) => value.toString(16).padStart(2, "0")).join("");
    };
    const manifest: PreparedVoiceModelManifest = {
      schemaVersion: 1,
      displayName: "Example Voice / test",
      format: "RVC",
      version: "v2",
      suppliedByUser: true,
      sourceArchive: { name: "example-voice.zip", sha256: "a".repeat(64) },
      model: { name: "test.pth", bytes: modelBytes.byteLength, sha256: await sha256(modelBytes), url: "/__taffy_voice_model/model" },
      index: { name: "test.index", bytes: indexBytes.byteLength, sha256: await sha256(indexBytes), url: "/__taffy_voice_model/index" },
      recommended: { pitch: 12, indexRatio: 0.5, protect: 0.3, chunkSize: 64 }
    };
    const calls: string[] = [];
    let loadParams: Record<string, unknown> | null = null;
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      calls.push(target);
      if (target.includes("/api/voice-changer-manager/")) return new Response("not found", { status: 404 });
      if (target === manifest.model.url) return new Response(modelBytes, { status: 200 });
      if (target === manifest.index.url) return new Response(indexBytes, { status: 200 });
      if (target.endsWith("/info")) {
        return new Response(JSON.stringify({ ...serverInfo, modelSlots: [{ ...serverInfo.modelSlots[0], slotIndex: 169, modelFile: "test.pth" }] }), { status: 200 });
      }
      if (target.endsWith("/load_model")) {
        const body = init?.body as FormData;
        loadParams = JSON.parse(String(body.get("params"))) as Record<string, unknown>;
      }
      return new Response("{}", { status: 200 });
    });
    const controller = new VoiceChangerController(undefined, request as unknown as typeof fetch);
    const progress: number[] = [];
    const info = await controller.importPreparedRvcModel(manifest, 169, (value) => progress.push(value.percent));

    expect(info.modelSlots[0].slotIndex).toBe(169);
    expect(calls.filter((url) => url.endsWith("/upload_file"))).toHaveLength(2);
    expect(calls.filter((url) => url.endsWith("/concat_uploaded_file"))).toHaveLength(2);
    expect(loadParams).toMatchObject({ voiceChangerType: "RVC", slot: 169, isSampleMode: false });
    expect(progress.at(-1)).toBe(100);
  });

  it("识别 VCClient v2，并通过 v2 API 配置、启动及确认本机设备", async () => {
    let active = false;
    let configuration: Record<string, unknown> = {
      current_slot_index: 168,
      voice_changer_input_mode: "client",
      audio_input_device_index: -1,
      audio_output_device_index: -1,
      audio_input_device_gain: 1,
      audio_output_device_gain: 1,
      gpu_device_id_int: -1,
      input_sample_rate: 48000,
      output_sample_rate: 48000
    };
    let slot: Record<string, unknown> = {
      slot_index: 168,
      voice_changer_type: "RVC",
      name: "Example Voice ONNX",
      model_file: "example-voice.onnx",
      index_file: "mygf.index",
      is_onnx: true,
      chunk_sec: 0.2,
      pitch_shift: 0,
      index_ratio: 0,
      protect_ratio: 0.5
    };
    const calls: string[] = [];
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      calls.push(`${init?.method ?? "GET"} ${target}`);
      if (target.endsWith("/api/voice-changer-manager/information")) {
        return json({
          local_voice_changer_interface_active: active,
          voice_changer_information: {
            slot_index: 168,
            voice_changer_type: "RVC",
            pitch_estimator_type: "rmvpe_onnx",
            pipeline_info: { slot_info: slot, chunk_sec: slot.chunk_sec }
          }
        });
      }
      if (target.endsWith("/api/configuration-manager/configuration")) {
        if (init?.method === "PUT") configuration = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json(configuration);
      }
      if (target.endsWith("/api/audio-device-manager/input_devices")) return json([{ kind: "audioinput", index: 14, name: "USB Mic", host_api: "Windows WASAPI", default_samplerate: 48000 }]);
      if (target.endsWith("/api/audio-device-manager/output_devices")) return json([{ kind: "audiooutput", index: 13, name: "USB Output", host_api: "Windows WASAPI", default_samplerate: 48000 }]);
      if (target.endsWith("/api/slot-manager/slots")) return json([slot]);
      if (target.endsWith("/api/slot-manager/slots/168")) {
        if (init?.method === "PUT") slot = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json(slot);
      }
      if (target.endsWith("/api/gpu-device-manager/devices")) return json([{ name: "GPU", device_id_int: 0, adapter_ram: 8_000_000_000 }]);
      if (target.endsWith("/api/voice-changer/operation/start_server_device")) {
        active = true;
        return json(null);
      }
      return new Response("not found", { status: 404 });
    });

    const controller = new VoiceChangerController(undefined, request as unknown as typeof fetch);
    const detected = await controller.probe();
    expect(detected.apiVersion).toBe("v2");
    expect(detected.serverAudioInputDevices[0]).toMatchObject({ index: 14, hostAPI: "Windows WASAPI", sampleRate: 48000 });

    const running = await controller.start({
      inputDeviceId: 14,
      outputDeviceId: 13,
      modelSlotIndex: 168,
      pitch: 12,
      indexRatio: 0.35,
      protect: 0.25,
      chunkSize: 48,
      inputGain: 1,
      outputGain: 0.75,
      denoiseLevel: "balanced"
    });
    expect(running.serverAudioStated).toBe(1);
    expect(configuration).toMatchObject({
      current_slot_index: 168,
      voice_changer_input_mode: "server",
      audio_input_device_index: 14,
      audio_output_device_index: 13,
      noise_gate: -52,
      enable_high_pass_filter: true,
      high_pass_filter_cutoff: 85,
      enable_low_pass_filter: true,
      low_pass_filter_cutoff: 12000,
      extra_frame_sec: 0.05,
      crossfade_sec: 0.03,
      sola_search_frame_sec: 0.008,
      gpu_device_id_int: 0
    });
    expect(slot).toMatchObject({ pitch_shift: 12, index_ratio: 0.35, protect_ratio: 0.25, chunk_sec: 0.128, pitch_estimator: "rmvpe_onnx" });
    expect(calls).toContain("POST http://127.0.0.1:18888/api/voice-changer/operation/start_server_device");
  });
});
