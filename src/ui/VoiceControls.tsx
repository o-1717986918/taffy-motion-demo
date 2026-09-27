import { AudioWaveform, Cable, Headphones, Mic2, PackageCheck, Power, RefreshCw, UploadCloud, Volume2 } from "lucide-react";
import type {
  PreparedVoiceModelManifest,
  VoiceConnectionState,
  VoiceImportProgress,
  VoiceServerInfo,
  VoiceStartOptions
} from "../voice/VoiceChangerController";

export interface VoiceControlsProps {
  endpoint: string;
  state: VoiceConnectionState;
  info: VoiceServerInfo | null;
  settings: VoiceStartOptions;
  performance: number[];
  error: string | null;
  busy: boolean;
  preparedModel: PreparedVoiceModelManifest | null;
  importProgress: VoiceImportProgress | null;
  importSlot: number;
  onEndpointChange: (value: string) => void;
  onSettingsChange: (value: VoiceStartOptions) => void;
  onImportSlotChange: (value: number) => void;
  onProbe: () => void;
  onStartRuntime: () => void;
  onImportPreparedModel: () => void;
  onStart: () => void;
  onStop: () => void;
}

const stateLabel: Record<VoiceConnectionState, string> = {
  offline: "BACKEND OFFLINE",
  checking: "CHECKING",
  ready: "RVC READY",
  live: "VOICE LIVE",
  error: "CONNECTION ERROR"
};

const latencyLabel = (chunk: number) => `${Math.round(chunk * 128 / 48)} ms 块`;
const formatMegabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const modelStem = (name?: string) => name?.replace(/\.(pth|onnx)$/i, "").toLowerCase();
const denoiseLabels = {
  off: "关闭",
  light: "轻度 · 保留更多气声",
  balanced: "均衡 · 推荐",
  strong: "强力 · 嘈杂环境"
} as const;

export function VoiceControls(props: VoiceControlsProps) {
  const patch = (next: Partial<VoiceStartOptions>) => props.onSettingsChange({ ...props.settings, ...next });
  const live = props.state === "live";
  const available = props.info !== null;
  const rvcModels = props.info?.modelSlots.filter((slot) => slot.voiceChangerType === "RVC") ?? [];
  const selectedModel = rvcModels.find((slot) => String(slot.slotIndex) === String(props.settings.modelSlotIndex));
  const preparedLoaded = props.preparedModel && rvcModels.some((slot) => modelStem(slot.modelFile) === modelStem(props.preparedModel?.model.name));
  const inferenceMs = props.performance[0];
  const selectedInput = props.info?.serverAudioInputDevices.find((device) => device.index === props.settings.inputDeviceId);
  const compatibleOutputs = props.info?.serverAudioOutputDevices.filter((device) => !selectedInput || (
    device.hostAPI === selectedInput.hostAPI
    && (!device.sampleRate || !selectedInput.sampleRate || device.sampleRate === selectedInput.sampleRate)
  )) ?? [];
  const selectInput = (inputDeviceId: number) => {
    const input = props.info?.serverAudioInputDevices.find((device) => device.index === inputDeviceId);
    const currentOutput = props.info?.serverAudioOutputDevices.find((device) => device.index === props.settings.outputDeviceId);
    const compatible = props.info?.serverAudioOutputDevices.filter((device) => !input || (
      device.hostAPI === input.hostAPI
      && (!device.sampleRate || !input.sampleRate || device.sampleRate === input.sampleRate)
    )) ?? [];
    const keepOutput = currentOutput && compatible.some((device) => device.index === currentOutput.index);
    const backendOutput = compatible.find((device) => device.index === props.info?.serverOutputDeviceId);
    patch({ inputDeviceId, outputDeviceId: keepOutput ? currentOutput.index : backendOutput?.index ?? compatible[0]?.index ?? -1 });
  };

  return (
    <>
      <div className={`voice-status-card is-${props.state}`}>
        <span className="voice-orbit"><AudioWaveform size={24} /></span>
        <div><strong>{stateLabel[props.state]}</strong><span>{live ? `${selectedModel?.name ?? "RVC"} 正在送往扬声器` : "麦克风 → RVC → 扬声器"}</span></div>
        <i aria-hidden="true" />
      </div>

      <section className="drawer-section">
        <div className="section-title-row"><h3>本机推理服务</h3><span>LOOPBACK ONLY</span></div>
        <div className="endpoint-row">
          <Cable size={15} />
          <input
            className="voice-endpoint-input"
            value={props.endpoint}
            onChange={(event) => props.onEndpointChange(event.target.value)}
            spellCheck={false}
            aria-label="变声后端地址"
          />
          <button className="endpoint-probe" onClick={props.onProbe} disabled={props.busy} aria-label="检测变声后端" title="检测后端"><RefreshCw size={15} /></button>
        </div>
        {props.error && <p className="field-error">{props.error}</p>}
        <p className="section-copy">已适配 w-okada VCClient v1.5 与 v2 本机接口{props.info?.apiVersion ? `；当前连接 ${props.info.apiVersion}` : ""}。原声音频由后端直接读取，不经过网页或公网。</p>
      </section>

      {props.preparedModel && (
        <section className="drawer-section prepared-voice-section">
          <div className="section-title-row"><h3>本机音色包</h3><span>USER SUPPLIED</span></div>
          <div className="prepared-model-card">
            <PackageCheck size={20} />
            <div>
              <strong>{props.preparedModel.displayName}</strong>
              <span>{props.preparedModel.version.toUpperCase()} · {formatMegabytes(props.preparedModel.model.bytes + props.preparedModel.index.bytes)} · SHA-256 已登记</span>
            </div>
            <i className={preparedLoaded ? "is-loaded" : ""}>{preparedLoaded ? "LOADED" : "LOCAL"}</i>
          </div>
          <div className="voice-import-row">
            <label><span>目标槽位</span><input type="number" min="0" max="169" step="1" value={props.importSlot} onChange={(event) => props.onImportSlotChange(Number(event.target.value))} disabled={props.busy || live} /></label>
            <button className="secondary-action" onClick={props.onImportPreparedModel} disabled={!available || props.busy || live}>
              <UploadCloud size={15} />{preparedLoaded ? "重新导入" : "导入 VCClient"}
            </button>
          </div>
          {props.importProgress && (
            <div className="voice-import-progress" aria-live="polite">
              <div><span>{props.importProgress.label}</span><strong>{props.importProgress.percent}%</strong></div>
              <i><b style={{ width: `${props.importProgress.percent}%` }} /></i>
            </div>
          )}
          <p className="section-copy">导入只发生在本机：页面读取已核验的 `.pth + .index`，再次校验哈希后发送到上面的 localhost 服务。导入槽位会被替换。</p>
        </section>
      )}

      <section className="drawer-section voice-route-section">
        <h3>信号路径</h3>
        <label className="voice-field">
          <span><AudioWaveform size={14} />音色模型</span>
          <select value={String(props.settings.modelSlotIndex)} onChange={(event) => patch({ modelSlotIndex: event.target.value })} disabled={!available || live}>
            {rvcModels.length ? rvcModels.map((slot) => (
              <option key={String(slot.slotIndex)} value={String(slot.slotIndex)}>{slot.name} · {slot.voiceChangerType}</option>
            )) : <option value="">VCClient 中尚无模型</option>}
          </select>
        </label>
        <span className="voice-route-line"><i /><em>VOICE MODEL</em><i /></span>
        <label className="voice-field">
          <span><Mic2 size={14} />麦克风输入</span>
          <select value={props.settings.inputDeviceId} onChange={(event) => selectInput(Number(event.target.value))} disabled={!available || live}>
            <option value={-1}>选择输入设备</option>
            {props.info?.serverAudioInputDevices.map((device) => <option key={`${device.hostAPI}-${device.index}`} value={device.index}>{device.name} · {device.hostAPI}</option>)}
          </select>
        </label>
        <span className="voice-route-line"><i /><em>LOCAL RVC</em><i /></span>
        <label className="voice-field">
          <span><Volume2 size={14} />扬声器输出</span>
          <select value={props.settings.outputDeviceId} onChange={(event) => patch({ outputDeviceId: Number(event.target.value) })} disabled={!available || live}>
            <option value={-1}>选择输出设备</option>
            {compatibleOutputs.map((device) => <option key={`${device.hostAPI}-${device.index}`} value={device.index}>{device.name} · {device.hostAPI} · {device.sampleRate ?? "?"} Hz</option>)}
          </select>
        </label>
        <p className="section-copy">扬声器列表会自动匹配麦克风的音频接口与采样率，避免 PortAudio 因混用 WASAPI、DirectSound 或 44.1/48 kHz 而卡死。</p>
      </section>

      <section className="drawer-section">
        <div className="section-title-row"><h3>麦克风前级净化</h3><span>BEFORE RVC</span></div>
        <label className="voice-field">
          <span><AudioWaveform size={14} />主动降噪</span>
          <select
            aria-label="麦克风主动降噪"
            value={props.settings.denoiseLevel ?? "balanced"}
            onChange={(event) => patch({ denoiseLevel: event.target.value as VoiceStartOptions["denoiseLevel"] })}
            disabled={live}
          >
            {Object.entries(denoiseLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <p className="section-copy">先用噪声门压低静音底噪，再以高通/低通滤除风噪和高频电流声，处理后才送进 RVC。强力档可能吞掉轻声、气声和清辅音。</p>
      </section>

      <div className="info-callout voice-warning"><Headphones size={18} /><p>扬声器监听容易被麦克风再次收音。正式使用建议戴耳机，或把输出设备改为虚拟音频线交给 OBS。</p></div>

      <button
        className={live ? "danger-action full-width voice-power" : "primary-action full-width voice-power"}
        onClick={live ? props.onStop : available ? props.onStart : props.onStartRuntime}
        disabled={props.busy}
      >
        <Power size={17} />{props.busy ? "正在配置音频链路" : live ? "停止变声输出" : available ? "启动塔菲变声" : "启动本机变声服务"}
      </button>

      <section className="drawer-section">
        <div className="section-title-row"><h3>塔菲声线参数</h3><span>{selectedModel?.voiceChangerType ?? "RVC"}</span></div>
        <button
          className="secondary-action full-width"
          type="button"
          onClick={() => patch({ chunkSize: 48, indexRatio: 0.35, protect: 0.25 })}
          disabled={live}
        >
          应用低延迟推荐值
        </button>
        <label className="range-field"><span>音高偏移 <code>{props.settings.pitch > 0 ? "+" : ""}{props.settings.pitch} st</code></span><input type="range" min="-12" max="24" step="1" value={props.settings.pitch} onChange={(event) => patch({ pitch: Number(event.target.value) })} disabled={live} /></label>
        <label className="range-field"><span>检索特征 <code>{Math.round(props.settings.indexRatio * 100)}%</code></span><input type="range" min="0" max="1" step="0.05" value={props.settings.indexRatio} onChange={(event) => patch({ indexRatio: Number(event.target.value) })} disabled={live} /></label>
        <label className="range-field"><span>清辅音保护 <code>{Math.round(props.settings.protect * 100)}%</code></span><input type="range" min="0" max="0.5" step="0.05" value={props.settings.protect} onChange={(event) => patch({ protect: Number(event.target.value) })} disabled={live} /></label>
        <div className="compact-grid">
          <label className="voice-field"><span>音频块</span><select value={props.settings.chunkSize} onChange={(event) => patch({ chunkSize: Number(event.target.value) })} disabled={live}>{[48, 64, 96, 128, 192, 256].map((value) => <option key={value} value={value}>{latencyLabel(value)}</option>)}</select></label>
          <label className="voice-field"><span>输入增益</span><select value={props.settings.inputGain} onChange={(event) => patch({ inputGain: Number(event.target.value) })} disabled={live}>{[0.5, 0.75, 1, 1.25, 1.5].map((value) => <option key={value} value={value}>{value.toFixed(2)}×</option>)}</select></label>
          <label className="voice-field"><span>输出增益</span><select value={props.settings.outputGain} onChange={(event) => patch({ outputGain: Number(event.target.value) })} disabled={live}>{[0.5, 0.75, 1, 1.25, 1.5].map((value) => <option key={value} value={value}>{value.toFixed(2)}×</option>)}</select></label>
        </div>
        <p className="section-copy">48 块会同步缩短 VCClient 的 Extra、Crossfade 与 SOLA 窗口；若出现断音，先回退到 64 块。</p>
        {inferenceMs != null && Number.isFinite(inferenceMs) && <div className="voice-perf"><span>BACKEND PROCESS</span><strong>{Math.round(inferenceMs)} ms</strong></div>}
      </section>

    </>
  );
}
