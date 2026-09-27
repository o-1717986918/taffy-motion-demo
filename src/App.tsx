import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Aperture, ChevronDown, Circle, Cpu, Frame, Mic2, ShieldCheck, WifiOff } from "lucide-react";
import { PmxAvatarAdapter, type QualityPreset, type StageBackground } from "./avatar/PmxAvatarAdapter";
import { CameraController } from "./camera/CameraController";
import { MotionBus } from "./core/MotionBus";
import { MotionCore, type MotionSensitivity } from "./core/MotionCore";
import type { DrawerView, ModelCapabilities, PerformanceSnapshot } from "./core/contracts";
import { MediaPipeFaceProvider } from "./tracking/MediaPipeFaceProvider";
import type { OverlayOptions } from "./overlay/OverlayRenderer";
import { WebRecorder } from "./output/WebRecorder";
import { loadBundledAvatarModel } from "./storage/BundledAvatar";
import { loadLastModelFolder, saveModelFolder } from "./storage/ModelCache";
import { AvatarPanel } from "./ui/AvatarPanel";
import { CameraPanel } from "./ui/CameraPanel";
import { ControlDock } from "./ui/ControlDock";
import { InspectorDrawer } from "./ui/InspectorDrawer";
import { ModelPickerDialog } from "./ui/ModelPickerDialog";
import { SignalScope } from "./ui/SignalScope";
import {
  DEFAULT_VOICE_ENDPOINT,
  VoiceChangerController,
  type PreparedVoiceModelManifest,
  type VoiceConnectionState,
  type VoiceImportProgress,
  type VoiceServerInfo,
  type VoiceStartOptions
} from "./voice/VoiceChangerController";
import "./styles.css";

const initialMetrics: PerformanceSnapshot = {
  captureFps: 0,
  inferenceFps: 0,
  renderFps: 0,
  inferenceMs: 0,
  latencyMs: 0,
  droppedFrames: 0,
  facePresent: false,
  posePresent: false,
  handsPresent: false,
  backend: "—"
};

const defaultOverlay: OverlayOptions = {
  enabled: true,
  mesh: false,
  contours: true,
  points: false,
  bounds: true,
  axes: true,
  pose: true,
  hands: true,
  mirrored: true
};

const loadStored = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
};

const saveDownload = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
};

export default function App() {
  const provider = useMemo(() => new MediaPipeFaceProvider(), []);
  const motionCore = useMemo(() => new MotionCore(), []);
  const motionBus = useMemo(() => new MotionBus(), []);
  const recorder = useMemo(() => new WebRecorder(), []);
  const voiceController = useMemo(() => new VoiceChangerController(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraPanelRef = useRef<HTMLElement>(null);
  const avatarPanelRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<CameraController | null>(null);
  const avatarRef = useRef<PmxAvatarAdapter | null>(null);
  const renderFpsRef = useRef(0);
  const allModelFilesRef = useRef<File[]>([]);
  const cacheRestoreAttemptedRef = useRef(false);
  const bundledModelAttemptedRef = useRef(false);
  const desktopVoiceBootAttemptedRef = useRef(false);
  const desktopVoiceSettingsFoundRef = useRef(false);
  const voiceProbeAttemptedRef = useRef(false);
  const voiceInactivePollsRef = useRef(0);

  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [capabilities, setCapabilities] = useState<ModelCapabilities | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelCandidates, setModelCandidates] = useState<File[]>([]);
  const [drawer, setDrawer] = useState<DrawerView | null>(null);
  const [split, setSplit] = useState(() => loadStored("taffy.split", 50));
  const [maximized, setMaximized] = useState<"camera" | "avatar" | null>(null);
  const [overlay, setOverlay] = useState<OverlayOptions>(() => ({ ...defaultOverlay, ...loadStored("taffy.overlay", defaultOverlay) }));
  const [motionSensitivity, setMotionSensitivity] = useState<MotionSensitivity>(() => loadStored("taffy.motion.sensitivity", "responsive"));
  const [upperBodyEnabled, setUpperBodyEnabled] = useState(() => loadStored("taffy.motion.upperBody", true));
  const [quality, setQuality] = useState<QualityPreset>(() => loadStored("taffy.quality", "balanced"));
  const [background, setBackground] = useState<StageBackground>(() => loadStored("taffy.background", "studio"));
  const [metrics, setMetrics] = useState(initialMetrics);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [swapEyes, setSwapEyes] = useState(false);
  const [manualMorphs, setManualMorphs] = useState<Record<string, boolean>>({});
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [avatarReady, setAvatarReady] = useState(false);
  const [voiceEndpoint, setVoiceEndpoint] = useState(() => loadStored("taffy.voice.endpoint", DEFAULT_VOICE_ENDPOINT));
  const [voiceState, setVoiceState] = useState<VoiceConnectionState>("offline");
  const [voiceInfo, setVoiceInfo] = useState<VoiceServerInfo | null>(null);
  const [voicePerformance, setVoicePerformance] = useState<number[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [preparedVoiceModel, setPreparedVoiceModel] = useState<PreparedVoiceModelManifest | null>(null);
  const [voiceImportProgress, setVoiceImportProgress] = useState<VoiceImportProgress | null>(null);
  const [voiceImportSlot, setVoiceImportSlot] = useState(169);
  const [voiceSettings, setVoiceSettings] = useState<VoiceStartOptions>(() => ({
    inputDeviceId: -1,
    outputDeviceId: -1,
    modelSlotIndex: "",
    pitch: 12,
    indexRatio: 0.35,
    protect: 0.25,
    chunkSize: 48,
    inputGain: 1,
    outputGain: 1,
    denoiseLevel: "balanced",
    ...loadStored<Partial<VoiceStartOptions>>("taffy.voice.settings", {})
  }));
  const [desktopVoiceSettingsReady, setDesktopVoiceSettingsReady] = useState(() => !window.taffyDesktop?.isDesktop);

  const logEvent = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setDiagnostics((current) => [...current.slice(-49), `${time}  ${message}`]);
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? null : current), 3500);
  }, []);

  useEffect(() => {
    motionCore.setSensitivity(motionSensitivity);
    motionCore.setUpperBodyEnabled(upperBodyEnabled);
    motionCore.setMirrorUpperBody(overlay.mirrored);
  }, [motionCore, motionSensitivity, overlay.mirrored, upperBodyEnabled]);

  const onAvatarReady = useCallback((adapter: PmxAvatarAdapter) => {
    avatarRef.current = adapter;
    adapter.setStatsListener((fps) => { renderFpsRef.current = fps; });
    adapter.setQuality(quality);
    adapter.setBackground(background);
    setAvatarReady(true);
  }, [background, quality]);

  useEffect(() => {
    const unsubscribeFrame = provider.onFrame((raw) => {
      const avatar = motionCore.process(raw);
      motionBus.publish(raw, avatar);
    });
    const unsubscribeError = provider.onError((message) => logEvent(`面捕：${message}`));
    return () => {
      unsubscribeFrame();
      unsubscribeError();
    };
  }, [logEvent, motionBus, motionCore, provider]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cameraStats = cameraRef.current?.getStats();
      const trackerStats = provider.getStats();
      const latest = motionBus.latest();
      setMetrics({
        captureFps: cameraStats?.captureFps ?? 0,
        inferenceFps: trackerStats.inferenceFps,
        renderFps: renderFpsRef.current,
        inferenceMs: Math.round(trackerStats.inferenceMs),
        latencyMs: latest.raw ? Math.max(0, Math.round(performance.now() - latest.raw.captureTimeMs)) : 0,
        droppedFrames: trackerStats.droppedFrames,
        facePresent: latest.raw?.face.present ?? false,
        posePresent: latest.raw?.pose?.present ?? false,
        handsPresent: Boolean(latest.raw?.hands?.length),
        backend: trackerStats.backend
      });
      setCalibrationProgress(motionCore.isCalibrating ? motionCore.calibrationProgress : 0);
    }, 250);
    return () => window.clearInterval(timer);
  }, [motionBus, motionCore, provider]);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  useEffect(() => {
    saveStoredSettings();
    function saveStoredSettings() {
      localStorage.setItem("taffy.split", JSON.stringify(split));
      localStorage.setItem("taffy.overlay", JSON.stringify(overlay));
      localStorage.setItem("taffy.quality", JSON.stringify(quality));
      localStorage.setItem("taffy.background", JSON.stringify(background));
      localStorage.setItem("taffy.motion.sensitivity", JSON.stringify(motionSensitivity));
      localStorage.setItem("taffy.motion.upperBody", JSON.stringify(upperBodyEnabled));
    }
  }, [background, motionSensitivity, overlay, quality, split, upperBodyEnabled]);

  useEffect(() => {
    const bridge = window.taffyDesktop;
    if (!bridge?.isDesktop) return;
    let active = true;
    void bridge.loadVoiceSettings().then((stored) => {
      if (!active) return;
      desktopVoiceSettingsFoundRef.current = Boolean(stored);
      if (stored) {
        setVoiceSettings((current) => ({ ...current, ...stored }));
        logEvent("已从桌面固定配置文件读取声线参数。");
      }
      setDesktopVoiceSettingsReady(true);
    }).catch((error) => {
      if (!active) return;
      logEvent(`桌面声线配置读取失败，将使用后端当前值：${error instanceof Error ? error.message : String(error)}`);
      setDesktopVoiceSettingsReady(true);
    });
    return () => { active = false; };
  }, [logEvent]);

  useEffect(() => {
    localStorage.setItem("taffy.voice.endpoint", JSON.stringify(voiceEndpoint));
    if (!window.taffyDesktop?.isDesktop) {
      localStorage.setItem("taffy.voice.settings", JSON.stringify(voiceSettings));
      return;
    }
    if (!desktopVoiceSettingsReady) return;
    if (!desktopVoiceSettingsFoundRef.current && !desktopVoiceBootAttemptedRef.current) return;
    void window.taffyDesktop.saveVoiceSettings(voiceSettings).catch((error) => {
      logEvent(`桌面声线配置保存失败：${error instanceof Error ? error.message : String(error)}`);
    });
  }, [desktopVoiceSettingsReady, logEvent, voiceEndpoint, voiceSettings]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        motionCore.reset();
        avatarRef.current?.resetToNeutral();
      }
    };
    const onDevicesChanged = async () => {
      const available = await navigator.mediaDevices?.enumerateDevices();
      setDevices((available ?? []).filter((device) => device.kind === "videoinput"));
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    navigator.mediaDevices?.addEventListener?.("devicechange", onDevicesChanged);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDevicesChanged);
    };
  }, [motionCore]);

  useEffect(() => () => {
    cameraRef.current?.stop();
    void provider.stop();
  }, [provider]);

  const startCamera = useCallback(async () => {
    if (!videoRef.current || cameraBusy) return;
    setCameraBusy(true);
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持摄像头访问，请使用新版 Chrome 或 Edge。 ");
      await provider.start();
      cameraRef.current ??= new CameraController(videoRef.current, provider);
      cameraRef.current.setTargetInferenceFps(voiceState === "live" ? 20 : quality === "light" ? 20 : 30);
      const stream = await cameraRef.current.start(selectedDevice || undefined);
      const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeId) setSelectedDevice(activeId);
      const available = await navigator.mediaDevices.enumerateDevices();
      setDevices(available.filter((device) => device.kind === "videoinput"));
      setCameraRunning(true);
      logEvent("摄像头已启动，视频帧进入本地 Worker。");
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = rawMessage.includes("Permission") || rawMessage.includes("NotAllowed")
        ? "摄像头权限被拒绝。请在地址栏允许摄像头后重试。"
        : rawMessage;
      setCameraError(message);
      logEvent(`摄像头：${message}`);
      cameraRef.current?.stop();
    } finally {
      setCameraBusy(false);
    }
  }, [cameraBusy, logEvent, provider, quality, selectedDevice, voiceState]);

  const stopCamera = useCallback(() => {
    cameraRef.current?.stop();
    setCameraRunning(false);
    motionCore.reset();
    avatarRef.current?.resetToNeutral();
    logEvent("摄像头已关闭，媒体轨道已停止。");
  }, [logEvent, motionCore]);

  const applyVoiceInfo = useCallback((info: VoiceServerInfo) => {
    setVoiceInfo(info);
    setVoiceSettings((current) => {
      const inputExists = info.serverAudioInputDevices.some((device) => device.index === current.inputDeviceId);
      const outputExists = info.serverAudioOutputDevices.some((device) => device.index === current.outputDeviceId);
      const backendInputExists = info.serverAudioInputDevices.some((device) => device.index === info.serverInputDeviceId);
      const backendOutputExists = info.serverAudioOutputDevices.some((device) => device.index === info.serverOutputDeviceId);
      const modelExists = info.modelSlots.some((slot) => String(slot.slotIndex) === String(current.modelSlotIndex));
      const backendModel = info.modelSlots.find((slot) => String(slot.slotIndex) === String(info.modelSlotIndex));
      const backendLive = info.serverAudioStated === 1;
      return {
        ...current,
        inputDeviceId: backendInputExists ? info.serverInputDeviceId : inputExists ? current.inputDeviceId : info.serverAudioInputDevices[0]?.index ?? -1,
        outputDeviceId: backendOutputExists ? info.serverOutputDeviceId : outputExists ? current.outputDeviceId : info.serverAudioOutputDevices[0]?.index ?? -1,
        modelSlotIndex: backendLive && backendModel
          ? backendModel.slotIndex
          : modelExists ? current.modelSlotIndex : backendModel?.slotIndex ?? info.modelSlots[0]?.slotIndex ?? "",
        pitch: backendLive ? info.tran : current.pitch,
        indexRatio: backendLive ? info.indexRatio : current.indexRatio,
        protect: backendLive ? info.protect : current.protect,
        chunkSize: backendLive ? info.serverReadChunkSize : current.chunkSize
      };
    });
    setVoiceState(info.serverAudioStated === 1 ? "live" : "ready");
  }, []);

  const probeVoice = useCallback(async () => {
    voiceProbeAttemptedRef.current = true;
    setVoiceBusy(true);
    setVoiceError(null);
    setVoiceState("checking");
    try {
      const endpoint = voiceController.setEndpoint(voiceEndpoint);
      if (endpoint !== voiceEndpoint) setVoiceEndpoint(endpoint);
      const info = await voiceController.probe();
      applyVoiceInfo(info);
      logEvent(`变声后端已连接：${info.modelSlots.length} 个模型，${info.serverAudioInputDevices.length} 个输入设备。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceInfo(null);
      setVoiceState(message.includes("仅允许") || message.includes("必须使用") || message.includes("不能包含") ? "error" : "offline");
      setVoiceError(message.includes("fetch") || message.includes("Failed") ? "未找到本机 VCClient。请先启动它的 HTTP 服务。" : message);
    } finally {
      setVoiceBusy(false);
    }
  }, [applyVoiceInfo, logEvent, voiceController, voiceEndpoint]);

  const startVoiceRuntime = useCallback(async () => {
    setVoiceBusy(true);
    setVoiceError(null);
    setVoiceState("checking");
    try {
      voiceController.setEndpoint(voiceEndpoint);
      await voiceController.startRuntime();
      const info = await voiceController.probe();
      applyVoiceInfo(info);
      showNotice("本机 VCClient 与塔菲变声链路已启动");
      logEvent("前端已拉起本机 VCClient，并完成模型、设备与音频链路配置。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceInfo(null);
      setVoiceState("error");
      setVoiceError(message.includes("fetch") || message.includes("Failed") ? "本机网页桥接器不可用，请重新运行启动脚本。" : message);
      logEvent(`本机 VCClient 启动失败：${message}`);
    } finally {
      setVoiceBusy(false);
    }
  }, [applyVoiceInfo, logEvent, showNotice, voiceController, voiceEndpoint]);

  useEffect(() => {
    if (!window.taffyDesktop?.isDesktop || !desktopVoiceSettingsReady || desktopVoiceBootAttemptedRef.current) return;
    desktopVoiceBootAttemptedRef.current = true;
    logEvent("桌面版正在准备内置 VCClient 与塔菲音色。");
    void (async () => {
      setVoiceBusy(true);
      setVoiceError(null);
      setVoiceState("checking");
      try {
        voiceController.setEndpoint(voiceEndpoint);
        await voiceController.startRuntime();
        const info = await voiceController.probe();
        const savedInput = info.serverAudioInputDevices.find((device) => device.index === voiceSettings.inputDeviceId);
        const savedOutput = info.serverAudioOutputDevices.find((device) => device.index === voiceSettings.outputDeviceId);
        const savedPairIsUsable = Boolean(savedInput && savedOutput
          && savedInput.hostAPI === savedOutput.hostAPI
          && (!savedInput.sampleRate || !savedOutput.sampleRate || savedInput.sampleRate === savedOutput.sampleRate));
        const savedModelExists = info.modelSlots.some((slot) => String(slot.slotIndex) === String(voiceSettings.modelSlotIndex));
        const persistedSettings = desktopVoiceSettingsFoundRef.current ? voiceSettings : {
          ...voiceSettings,
          pitch: info.tran,
          indexRatio: info.indexRatio,
          protect: info.protect,
          chunkSize: info.serverReadChunkSize,
          inputGain: info.serverInputAudioGain,
          outputGain: info.serverOutputAudioGain
        };
        const restoredSettings: VoiceStartOptions = {
          ...persistedSettings,
          inputDeviceId: savedPairIsUsable ? persistedSettings.inputDeviceId : info.serverInputDeviceId,
          outputDeviceId: savedPairIsUsable ? persistedSettings.outputDeviceId : info.serverOutputDeviceId,
          modelSlotIndex: savedModelExists ? persistedSettings.modelSlotIndex : info.modelSlotIndex
        };
        const restored = await voiceController.start(restoredSettings);
        setVoiceSettings(restoredSettings);
        applyVoiceInfo(restored);
        showNotice("塔菲模型与已保存的声线参数已恢复");
        logEvent("桌面版已恢复保存的声线、增益、降噪、延迟和音频设备参数。");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setVoiceInfo(null);
        setVoiceState("error");
        setVoiceError(message.includes("fetch") || message.includes("Failed") ? "内置 VCClient 启动失败。" : message);
        logEvent(`桌面版变声恢复失败：${message}`);
      } finally {
        setVoiceBusy(false);
      }
    })();
  }, [applyVoiceInfo, desktopVoiceSettingsReady, logEvent, showNotice, voiceController, voiceEndpoint, voiceSettings]);

  useEffect(() => {
    void voiceController.discoverPreparedModel().then((manifest) => {
      setPreparedVoiceModel(manifest);
      if (manifest) logEvent(`已发现用户提供的本机音色：${manifest.displayName}。`);
    }).catch((error) => {
      logEvent(`本机音色清单不可用：${error instanceof Error ? error.message : String(error)}`);
    });
  }, [logEvent, voiceController]);

  const importPreparedVoiceModel = useCallback(async () => {
    if (!preparedVoiceModel) return;
    setVoiceBusy(true);
    setVoiceError(null);
    setVoiceImportProgress({ phase: "download", label: "准备本机模型", percent: 0 });
    try {
      voiceController.setEndpoint(voiceEndpoint);
      const info = await voiceController.importPreparedRvcModel(preparedVoiceModel, voiceImportSlot, setVoiceImportProgress);
      applyVoiceInfo(info);
      setVoiceSettings((current) => ({
        ...current,
        modelSlotIndex: voiceImportSlot,
        pitch: preparedVoiceModel.recommended.pitch,
        indexRatio: preparedVoiceModel.recommended.indexRatio,
        protect: preparedVoiceModel.recommended.protect,
        chunkSize: preparedVoiceModel.recommended.chunkSize
      }));
      setVoiceState("ready");
      showNotice(`${preparedVoiceModel.displayName} 已载入 VCClient`);
      logEvent(`本机 RVC 音色已导入槽位 ${voiceImportSlot}，文件哈希复核通过。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceState("error");
      setVoiceError(message.includes("fetch") || message.includes("Failed") ? "无法连接本机 VCClient；请先启动 HTTP 服务。" : message);
      setVoiceImportProgress(null);
      logEvent(`音色导入失败：${message}`);
    } finally {
      setVoiceBusy(false);
    }
  }, [applyVoiceInfo, logEvent, preparedVoiceModel, showNotice, voiceController, voiceEndpoint, voiceImportSlot]);

  const startVoice = useCallback(async () => {
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      voiceController.setEndpoint(voiceEndpoint);
      const info = await voiceController.start(voiceSettings);
      voiceInactivePollsRef.current = 0;
      applyVoiceInfo(info);
      setVoiceState("live");
      showNotice("塔菲变声已送往所选扬声器");
      logEvent("本机 RVC 链路已启动：麦克风 → 模型 → 扬声器。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceState("error");
      setVoiceError(message);
      logEvent(`变声器启动失败：${message}`);
    } finally {
      setVoiceBusy(false);
    }
  }, [applyVoiceInfo, logEvent, showNotice, voiceController, voiceEndpoint, voiceSettings]);

  const stopVoice = useCallback(async () => {
    setVoiceBusy(true);
    try {
      const info = await voiceController.stop();
      applyVoiceInfo(info);
      setVoiceState("ready");
      logEvent("变声输出已停止，后端释放音频设备。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceState("error");
      setVoiceError(message);
    } finally {
      setVoiceBusy(false);
    }
  }, [applyVoiceInfo, logEvent, voiceController]);

  useEffect(() => {
    if (drawer === "voice" && !voiceInfo && !voiceBusy && !voiceProbeAttemptedRef.current) void probeVoice();
  }, [drawer, probeVoice, voiceBusy, voiceInfo]);

  useEffect(() => {
    if (voiceState !== "live") return;
    const timer = window.setInterval(() => {
      void Promise.all([voiceController.probe(), voiceController.performance()]).then(([info, performance]) => {
        setVoiceInfo(info);
        setVoicePerformance(performance);
        if (info.serverAudioStated === 1) {
          voiceInactivePollsRef.current = 0;
        } else {
          voiceInactivePollsRef.current += 1;
          if (voiceInactivePollsRef.current >= 2) setVoiceState("ready");
        }
      }).catch(() => {
        setVoiceState("error");
        setVoiceError("与本机变声后端的连接已中断。");
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [voiceController, voiceState]);

  useEffect(() => {
    cameraRef.current?.setTargetInferenceFps(voiceState === "live" ? 20 : quality === "light" ? 20 : 30);
  }, [quality, voiceState]);

  const changeDevice = useCallback(async (deviceId: string) => {
    setSelectedDevice(deviceId);
    if (!cameraRunning || !cameraRef.current) return;
    setCameraBusy(true);
    try {
      await cameraRef.current.start(deviceId);
      motionCore.reset();
      logEvent("摄像头设备已切换，滤波状态已清空。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCameraError(message);
      setCameraRunning(false);
      logEvent(`切换摄像头失败：${message}`);
    } finally {
      setCameraBusy(false);
    }
  }, [cameraRunning, logEvent, motionCore]);

  const chooseModel = useCallback(() => folderInputRef.current?.click(), []);

  const loadModel = useCallback(async (modelFile: File, persistModel = true) => {
    if (!avatarRef.current) return;
    setModelCandidates([]);
    setModelLoading(true);
    logEvent(`开始加载模型：${modelFile.name}`);
    try {
      const source = { modelFile, referenceFiles: allModelFilesRef.current };
      const report = await avatarRef.current.load(source);
      setCapabilities(report);
      setDrawer("model");
      motionCore.reset();
      showNotice(`${report.displayName} 已进入舞台`);
      logEvent(`模型已加载：${report.boneCount} 骨骼，${report.morphCount} 形态键，${report.warnings.length} 个警告。`);
      if (persistModel) {
        try {
          await saveModelFolder(source);
          logEvent("模型文件夹已缓存到本机浏览器存储。");
        } catch {
          logEvent("本机存储配额不足；下次打开时需要重新选择模型文件夹。");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showNotice("模型加载失败，原舞台已保留");
      logEvent(`模型加载失败：${message}`);
      setDrawer("diagnostics");
    } finally {
      setModelLoading(false);
    }
  }, [logEvent, motionCore, showNotice]);

  useEffect(() => {
    if (!avatarReady || !window.taffyDesktop?.isDesktop || bundledModelAttemptedRef.current) return;
    bundledModelAttemptedRef.current = true;
    cacheRestoreAttemptedRef.current = true;
    logEvent("正在载入桌面版内置塔菲 PMX。");
    void loadBundledAvatarModel().then((source) => {
      allModelFilesRef.current = source.referenceFiles;
      return loadModel(source.modelFile, false);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logEvent(`内置塔菲模型加载失败：${message}`);
      showNotice("内置塔菲模型不可用，可手动选择模型文件夹");
    });
  }, [avatarReady, loadModel, logEvent, showNotice]);

  useEffect(() => {
    if (window.taffyDesktop?.isDesktop) return;
    if (!avatarReady || cacheRestoreAttemptedRef.current) return;
    cacheRestoreAttemptedRef.current = true;
    void loadLastModelFolder().then((source) => {
      if (!source || capabilities) return;
      allModelFilesRef.current = source.referenceFiles;
      logEvent("正在从本机浏览器存储恢复上次模型。");
      void loadModel(source.modelFile);
    }).catch(() => {
      logEvent("上次模型缓存不可用，请重新选择模型文件夹。");
    });
  }, [avatarReady, capabilities, loadModel, logEvent]);

  const onFolderSelected = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const allFiles = Array.from(files);
    const pmxFiles = allFiles.filter((file) => /\.(pmx|pmd)$/i.test(file.name));
    allModelFilesRef.current = allFiles;
    if (pmxFiles.length === 0) {
      showNotice("所选文件夹中没有 PMX / PMD 文件");
      logEvent("模型扫描：文件夹中未发现 PMX / PMD。");
    } else if (pmxFiles.length === 1) {
      void loadModel(pmxFiles[0]);
    } else {
      setModelCandidates(pmxFiles);
    }
    if (folderInputRef.current) folderInputRef.current.value = "";
  }, [loadModel, logEvent, showNotice]);

  const enterFullscreen = useCallback(async (kind: "camera" | "avatar") => {
    const element = kind === "camera" ? cameraPanelRef.current : avatarPanelRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      await element.requestFullscreen();
      setMaximized(null);
    } catch {
      setMaximized(kind);
      showNotice("浏览器未允许全屏，已切换为应用内最大化");
    }
  }, [showNotice]);

  const exitExpanded = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    setMaximized(null);
  }, []);

  const startCalibration = useCallback(() => {
    if (!metrics.facePresent) return;
    motionCore.beginCalibration();
    showNotice("请正视镜头并保持自然表情 2 秒");
    logEvent("开始中立位校准。");
  }, [logEvent, metrics.facePresent, motionCore, showNotice]);

  const changeQuality = useCallback((value: QualityPreset) => {
    setQuality(value);
    cameraRef.current?.setTargetInferenceFps(voiceState === "live" ? 20 : value === "light" ? 20 : 30);
    avatarRef.current?.setQuality(value);
    logEvent(`性能档位切换为：${value}。`);
  }, [logEvent, voiceState]);

  const changeBackground = useCallback((value: StageBackground) => {
    setBackground(value);
    avatarRef.current?.setBackground(value);
  }, []);

  const toggleRecording = useCallback(async () => {
    const canvas = avatarRef.current?.getCanvas();
    if (!canvas) return;
    try {
      if (!recording) {
        recorder.start(canvas, 60);
        setRecording(true);
        logEvent("舞台本地录制开始。");
      } else {
        const blob = await recorder.stop();
        saveDownload(blob, `taffy-stage-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`);
        setRecording(false);
        logEvent(`舞台录制完成：${(blob.size / 1024 / 1024).toFixed(1)} MB。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEvent(`录制失败：${message}`);
      showNotice("录制失败，请查看诊断");
    }
  }, [logEvent, recorder, recording, showNotice]);

  const toggleManualMorph = useCallback((name: string) => {
    setManualMorphs((current) => {
      const active = !current[name];
      motionCore.setManualMorph(name, active ? 1 : 0);
      const now = performance.now();
      const last = motionBus.latest().raw;
      const raw = last ?? {
        schemaVersion: 1 as const,
        source: "replay" as const,
        captureTimeMs: now,
        producedTimeMs: now,
        inferenceTimeMs: 0,
        face: {
          present: false,
          confidence: 0,
          headRotation: [0, 0, 0, 1] as [number, number, number, number],
          gaze: { left: [0, 0] as [number, number], right: [0, 0] as [number, number] },
          blendshapes: {}
        }
      };
      motionBus.publish(raw, motionCore.process(raw, now));
      return { ...current, [name]: active };
    });
  }, [motionBus, motionCore]);

  const resetMotion = useCallback(() => {
    motionCore.clearManualMorphs();
    motionCore.reset();
    setManualMorphs({});
    avatarRef.current?.resetToNeutral();
  }, [motionCore]);

  const changeSwapEyes = useCallback((value: boolean) => {
    setSwapEyes(value);
    motionCore.setSwapEyes(value);
    motionCore.reset();
  }, [motionCore]);

  const changeMotionSensitivity = useCallback((value: MotionSensitivity) => {
    setMotionSensitivity(value);
    showNotice(value === "responsive" ? "动作响应已提高" : value === "stable" ? "动作已切换为稳定优先" : "动作已切换为均衡");
    logEvent(`动作灵敏度切换为：${value}。`);
  }, [logEvent, showNotice]);

  const changeUpperBodyEnabled = useCallback((value: boolean) => {
    setUpperBodyEnabled(value);
    if (!value) avatarRef.current?.resetToNeutral();
    logEvent(`上半身动作识别：${value ? "开启" : "关闭"}。`);
  }, [logEvent]);

  const exportDiagnostics = useCallback(() => {
    const camera = cameraRef.current?.getStats();
    const report = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        screen: `${screen.width}x${screen.height}`,
        crossOriginIsolated
      },
      settings: { quality, background, overlay: { ...overlay }, swapEyes, motionSensitivity, upperBodyEnabled, voice: { state: voiceState, modelSlotIndex: voiceSettings.modelSlotIndex, chunkSize: voiceSettings.chunkSize, denoiseLevel: voiceSettings.denoiseLevel } },
      metrics,
      camera: camera ? { width: camera.width, height: camera.height, captureFps: camera.captureFps } : null,
      model: capabilities ? {
        fileName: capabilities.fileName,
        sha256: capabilities.sha256,
        boneCount: capabilities.boneCount,
        morphCount: capabilities.morphCount,
        warnings: capabilities.warnings
      } : null,
      events: diagnostics
    };
    saveDownload(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }), "taffy-motion-diagnostics.json");
  }, [background, capabilities, diagnostics, metrics, motionSensitivity, overlay, quality, swapEyes, upperBodyEnabled, voiceSettings.chunkSize, voiceSettings.denoiseLevel, voiceSettings.modelSlotIndex, voiceState]);

  const beginDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const workspace = workspaceRef.current;
    if (!workspace || window.innerWidth < 820) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      const rect = workspace.getBoundingClientRect();
      const next = Math.max(30, Math.min(70, (move.clientX - rect.left) / rect.width * 100));
      setSplit(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/INPUT|SELECT|TEXTAREA/.test(target.tagName)) return;
      if (event.key === "1") void enterFullscreen("camera");
      else if (event.key === "2") void enterFullscreen("avatar");
      else if (event.key === "0") exitExpanded();
      else if (event.key.toLowerCase() === "c") startCalibration();
      else if (event.key.toLowerCase() === "m") setOverlay((current) => ({ ...current, mirrored: !current.mirrored }));
      else if (event.key.toLowerCase() === "d") setOverlay((current) => ({ ...current, enabled: !current.enabled }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enterFullscreen, exitExpanded, startCalibration]);

  const activeMorph = motionBus.latest().avatar?.activeMorphs[0];

  return (
    <div className="app-shell">
      <div className="studio-atmosphere" aria-hidden="true"><i /><i /><i /></div>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Aperture size={21} /></span>
          <div><strong>TAFFY <em>MOTION</em></strong><span>LOCAL PERFORMANCE DESK · 0.6.2</span></div>
          <span className="brand-edition">1883</span>
        </div>

        <div className="topbar-status">
          <button className="model-status" onClick={() => setDrawer("model")}>
            <span><Frame size={15} />{capabilities?.displayName ?? "未载入 PMX"}</span><ChevronDown size={14} />
          </button>
          <div className={`live-status ${cameraRunning ? "is-live" : ""}`}><Circle size={8} fill="currentColor" />{cameraRunning ? "LIVE" : "OFF AIR"}</div>
          <button className={`voice-top-status is-${voiceState}`} onClick={() => setDrawer("voice")}><Mic2 size={13} /><span>{voiceState === "live" ? "VOICE LIVE" : voiceState === "ready" ? "RVC READY" : "VOICE OFF"}</span></button>
        </div>

        <div className="metric-strip" aria-label="实时性能">
          <div><span>CAP / AI</span><strong>{metrics.captureFps}<i>/</i>{metrics.inferenceFps}</strong><small>FPS</small></div>
          <div><span>RENDER</span><strong>{metrics.renderFps}</strong><small>FPS</small></div>
          <div><span>LATENCY</span><strong>{metrics.latencyMs}</strong><small>MS</small></div>
          <div><span>DROPS</span><strong>{metrics.droppedFrames}</strong><small>FR</small></div>
          <div className="privacy-chip"><ShieldCheck size={15} /><span>LOCAL<br />ONLY</span></div>
        </div>
      </header>

      <div className="signal-band">
        <div className="signal-label"><Cpu size={14} /><span>LIVE SIGNAL</span><strong>{metrics.backend}</strong></div>
        <SignalScope bus={motionBus} />
        <div className="signal-readout">
          <span>{metrics.facePresent && metrics.posePresent && metrics.handsPresent ? "FACE + BODY + HANDS LOCKED" : metrics.facePresent && metrics.posePresent ? "FACE + UPPER BODY LOCKED" : metrics.facePresent ? "FACE LOCKED" : "WAITING FOR FACE"}</span>
          <strong>{activeMorph ? `${activeMorph.name.toUpperCase()} ${Math.round(activeMorph.weight * 100)}%` : "NEUTRAL"}</strong>
        </div>
      </div>

      <main
        ref={workspaceRef}
        className="workspace"
        data-maximized={maximized ?? ""}
        style={{ "--split": `${split}%` } as React.CSSProperties}
      >
        <CameraPanel
          panelRef={cameraPanelRef}
          videoRef={videoRef}
          bus={motionBus}
          options={overlay}
          onOptionsChange={setOverlay}
          running={cameraRunning}
          busy={cameraBusy}
          error={cameraError}
          devices={devices}
          selectedDevice={selectedDevice}
          onDeviceChange={(deviceId) => { void changeDevice(deviceId); }}
          onStart={() => { void startCamera(); }}
          onStop={stopCamera}
          onFullscreen={() => { void enterFullscreen("camera"); }}
        />
        <button className="split-handle" onPointerDown={beginDrag} aria-label="拖动调整两个画面的宽度" title="拖动调整画面比例"><span /></button>
        <AvatarPanel
          panelRef={avatarPanelRef}
          bus={motionBus}
          capabilities={capabilities}
          loading={modelLoading}
          background={background}
          onReady={onAvatarReady}
          onChooseModel={chooseModel}
          onOpenOutput={() => setDrawer("output")}
          onFullscreen={() => { void enterFullscreen("avatar"); }}
        />
      </main>

      <ControlDock
        activeView={drawer}
        cameraRunning={cameraRunning}
        facePresent={metrics.facePresent}
        calibrationProgress={calibrationProgress}
        onCalibrate={startCalibration}
        onChooseModel={chooseModel}
        onOpen={(view) => setDrawer((current) => current === view ? null : view)}
      />

      <InspectorDrawer
        view={drawer}
        bus={motionBus}
        capabilities={capabilities}
        metrics={metrics}
        quality={quality}
        background={background}
        recording={recording}
        swapEyes={swapEyes}
        motionSensitivity={motionSensitivity}
        upperBodyEnabled={upperBodyEnabled}
        manualMorphs={manualMorphs}
        diagnostics={diagnostics}
        voice={{
          endpoint: voiceEndpoint,
          state: voiceState,
          info: voiceInfo,
          settings: voiceSettings,
          performance: voicePerformance,
          error: voiceError,
          busy: voiceBusy,
          preparedModel: preparedVoiceModel,
          importProgress: voiceImportProgress,
          importSlot: voiceImportSlot,
          onEndpointChange: setVoiceEndpoint,
          onSettingsChange: setVoiceSettings,
          onImportSlotChange: setVoiceImportSlot,
          onProbe: () => { void probeVoice(); },
          onStartRuntime: () => { void startVoiceRuntime(); },
          onImportPreparedModel: () => { void importPreparedVoiceModel(); },
          onStart: () => { void startVoice(); },
          onStop: () => { void stopVoice(); }
        }}
        onClose={() => setDrawer(null)}
        onQualityChange={changeQuality}
        onBackgroundChange={changeBackground}
        onRecordingToggle={() => { void toggleRecording(); }}
        onSwapEyesChange={changeSwapEyes}
        onMotionSensitivityChange={changeMotionSensitivity}
        onUpperBodyEnabledChange={changeUpperBodyEnabled}
        onManualMorphToggle={toggleManualMorph}
        onExportDiagnostics={exportDiagnostics}
        onResetMotion={resetMotion}
      />

      {maximized && <button className="exit-maximized" onClick={exitExpanded}>退出最大化 <kbd>0</kbd></button>}
      {notice && <div className="toast" role="status">{notice}</div>}
      {!navigator.onLine && <div className="offline-badge"><WifiOff size={14} />离线运行</div>}

      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        accept=".pmx,.pmd,image/*,.spa,.sph,.tga,.dds"
        onChange={(event) => onFolderSelected(event.target.files)}
      />
      <ModelPickerDialog files={modelCandidates} onSelect={(file) => { void loadModel(file); }} onClose={() => setModelCandidates([])} />
    </div>
  );
}
