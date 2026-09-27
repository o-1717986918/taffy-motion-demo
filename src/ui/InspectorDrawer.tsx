import { useEffect, useState } from "react";
import {
  Activity,
  BadgeInfo,
  Check,
  CircleAlert,
  Download,
  Eye,
  Gauge,
  MonitorUp,
  Radio,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Video,
  X
} from "lucide-react";
import type { QualityPreset, StageBackground } from "../avatar/PmxAvatarAdapter";
import type { MotionSensitivity } from "../core/MotionCore";
import type { MotionBus } from "../core/MotionBus";
import type { DrawerView, ModelCapabilities, PerformanceSnapshot } from "../core/contracts";
import { taffyProfile } from "../profiles/taffy-1883";
import { VoiceControls, type VoiceControlsProps } from "./VoiceControls";

interface InspectorDrawerProps {
  view: DrawerView | null;
  bus: MotionBus;
  capabilities: ModelCapabilities | null;
  metrics: PerformanceSnapshot;
  quality: QualityPreset;
  background: StageBackground;
  recording: boolean;
  swapEyes: boolean;
  motionSensitivity: MotionSensitivity;
  upperBodyEnabled: boolean;
  manualMorphs: Record<string, boolean>;
  diagnostics: string[];
  voice: VoiceControlsProps;
  onClose: () => void;
  onQualityChange: (quality: QualityPreset) => void;
  onBackgroundChange: (background: StageBackground) => void;
  onRecordingToggle: () => void;
  onSwapEyesChange: (value: boolean) => void;
  onMotionSensitivityChange: (value: MotionSensitivity) => void;
  onUpperBodyEnabledChange: (value: boolean) => void;
  onManualMorphToggle: (name: string) => void;
  onExportDiagnostics: () => void;
  onResetMotion: () => void;
}

const viewTitles: Record<DrawerView, { kicker: string; title: string }> = {
  model: { kicker: "MODEL / PROFILE", title: "模型能力" },
  expressions: { kicker: "MOTION / SIGNALS", title: "表情监视器" },
  voice: { kicker: "VOICE / LOCAL RVC", title: "塔菲变声链路" },
  performance: { kicker: "SYSTEM / LOAD", title: "性能档位" },
  output: { kicker: "PROGRAM / OUTPUT", title: "舞台输出" },
  diagnostics: { kicker: "SYSTEM / LOG", title: "诊断" },
  about: { kicker: "CREDITS / PRIVACY", title: "关于与借物表" }
};

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const expressionLabels = {
  neutral: "中立",
  happy: "开心",
  shy: "害羞",
  wronged: "委屈",
  angry: "生气",
  shocked: "震惊",
  heart: "心动"
} as const;

const gestureLabels = {
  waveLeft: "左手挥手",
  waveRight: "右手挥手",
  handsUp: "双手举起",
  pointLeft: "左手指向",
  pointRight: "右手指向",
  armsCrossed: "双臂交叉",
  handOnCheek: "托腮",
  coverMouth: "捂嘴",
  touchHead: "摸头",
  shrug: "耸肩",
  leanForward: "身体前倾",
  leanBackward: "身体后仰",
  leanLeft: "身体左倾",
  leanRight: "身体右倾"
} as const;

const handGestureLabels = {
  neutral: "—",
  open: "张开",
  fist: "握拳",
  peace: "剪刀手",
  ok: "OK",
  fingerHeart: "比心",
  pointing: "指向"
} as const;

function StatRow({ label, value }: { label: string; value: string | number }) {
  return <div className="stat-row"><span>{label}</span><strong>{value}</strong></div>;
}

function SignalBar({ label, value, color = "cyan" }: { label: string; value: number; color?: "cyan" | "coral" | "amber" }) {
  return (
    <div className="signal-bar">
      <div><span>{label}</span><code>{Math.round(value * 100)}%</code></div>
      <span className="signal-track"><i className={`signal-fill signal-fill--${color}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></span>
    </div>
  );
}

export function InspectorDrawer(props: InspectorDrawerProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (props.view !== "expressions") return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 150);
    return () => window.clearInterval(timer);
  }, [props.view]);
  void tick;

  if (!props.view) return null;
  const title = viewTitles[props.view];
  const latest = props.bus.latest();
  const raw = latest.raw?.face.blendshapes ?? {};
  const morphs = latest.avatar?.morphs ?? {};
  const avatar = latest.avatar;

  return (
    <aside className="inspector" aria-label={title.title}>
      <header className="inspector-header">
        <div><span>{title.kicker}</span><h2>{title.title}</h2></div>
        <button className="close-button" onClick={props.onClose} aria-label="关闭侧栏" title="关闭"><X size={20} /></button>
      </header>

      <div className="inspector-body">
        {props.view === "model" && (
          props.capabilities ? (
            <>
              <div className={`capability-banner is-${props.capabilities.level}`}>
                {props.capabilities.level === "ready" ? <Check size={19} /> : <CircleAlert size={19} />}
                <div><strong>{props.capabilities.level === "ready" ? "全部核心能力可用" : "模型已载入，部分能力降级"}</strong><span>映射按名称与模型哈希绑定</span></div>
              </div>
              <section className="drawer-section">
                <h3>文件检查</h3>
                <StatRow label="显示名称" value={props.capabilities.displayName} />
                <StatRow label="PMX 大小" value={formatBytes(props.capabilities.sizeBytes)} />
                <StatRow label="文件夹资源" value={formatBytes(props.capabilities.totalFolderBytes)} />
                <StatRow label="贴图文件" value={props.capabilities.textureCount} />
                <StatRow label="骨骼 / 形态键" value={`${props.capabilities.boneCount} / ${props.capabilities.morphCount}`} />
              </section>
              <section className="drawer-section">
                <h3>动作能力</h3>
                <div className="tag-list">{props.capabilities.readyFeatures.map((feature) => <span key={feature}><Check size={12} />{feature}</span>)}</div>
                {props.capabilities.warnings.length > 0 && <ul className="warning-list">{props.capabilities.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
              </section>
              <section className="drawer-section" data-testid="pmx-usage-audit">
                <h3>PMX 使用审计</h3>
                <StatRow label="持续驱动骨骼" value={`${props.capabilities.drivenBones.length} / ${props.capabilities.boneCount}`} />
                <StatRow label="自动 / 手动形态键" value={`${props.capabilities.automaticMorphs.length} / ${props.capabilities.manualMorphs.length}`} />
                <StatRow label="尚未映射形态键" value={props.capabilities.unmappedMorphs.length} />
                <details>
                  <summary>查看尚未映射的形态键</summary>
                  <p className="section-copy">{props.capabilities.unmappedMorphs.join(" · ") || "无"}</p>
                </details>
              </section>
              <section className="drawer-section">
                <h3>模型指纹</h3>
                <code className="hash-code">{props.capabilities.sha256}</code>
              </section>
            </>
          ) : <div className="drawer-empty"><SlidersHorizontal size={28} /><h3>尚未载入模型</h3><p>选择模型文件夹后，这里会展示骨骼、形态键、贴图和降级项。</p></div>
        )}

        {props.view === "expressions" && (
          <>
            <section className="drawer-section">
              <div className="section-title-row"><h3>动作捕捉</h3><span className={`mini-status ${latest.raw?.pose?.present ? "is-on" : ""}`}>{latest.raw?.hands?.length ? "FACE + BODY + HANDS" : latest.raw?.pose?.present ? "UPPER BODY" : "FACE ONLY"}</span></div>
              <div className="preset-stack">
                {([
                  ["responsive", "灵敏（推荐）", "更小死区 · 更强表情与转头响应"],
                  ["balanced", "均衡", "响应与抗抖动平衡"],
                  ["stable", "稳定", "更强平滑 · 适合弱光或低帧率"]
                ] as Array<[MotionSensitivity, string, string]>).map(([value, label, detail]) => (
                  <button key={value} className={props.motionSensitivity === value ? "is-active" : ""} onClick={() => props.onMotionSensitivityChange(value)}>
                    <span className="radio-mark">{props.motionSensitivity === value && <span />}</span>
                    <span><strong>{label}</strong><small>{detail}</small></span>
                  </button>
                ))}
              </div>
              <label className="switch-row"><span><Activity size={16} />上半身与双臂跟随</span><input type="checkbox" checked={props.upperBodyEnabled} onChange={(event) => props.onUpperBodyEnabledChange(event.target.checked)} /></label>
            </section>
            <section className="drawer-section">
              <div className="section-title-row"><h3>表情组合</h3><span className={`mini-status ${avatar?.expression.name !== "neutral" ? "is-on" : ""}`}>{avatar ? expressionLabels[avatar.expression.name] : "中立"}</span></div>
              <SignalBar label={avatar ? expressionLabels[avatar.expression.name] : "中立"} value={avatar?.expression.confidence ?? 0} color="coral" />
              <div className="tag-list">
                {(["开心", "害羞", "委屈", "生气", "震惊", "心动"] as const).map((name) => <span key={name}>{name}</span>)}
              </div>
            </section>
            <section className="drawer-section">
              <div className="section-title-row"><h3>最终 PMX 权重</h3><span className={`mini-status ${latest.avatar?.facePresent ? "is-on" : ""}`}>{latest.avatar?.facePresent ? "FACE" : "IDLE"}</span></div>
              <SignalBar label="双眼眨眼" value={morphs.blinkBoth ?? 0} color="coral" />
              <SignalBar label="左眼" value={morphs.blinkLeft ?? 0} color="coral" />
              <SignalBar label="右眼" value={morphs.blinkRight ?? 0} color="coral" />
              <SignalBar label="张嘴 / あ" value={morphs.mouthA ?? 0} color="amber" />
              <SignalBar label="微笑" value={morphs.smile ?? 0} />
              <SignalBar label="笑眼 / 笑い" value={morphs.happyEyes ?? 0} />
              <SignalBar label="闭嘴 / ん" value={morphs.mouthClosed ?? 0} color="amber" />
              <SignalBar label="惊讶" value={morphs.surprised ?? 0} />
            </section>
            <section className="drawer-section">
              <div className="section-title-row"><h3>上半身手势</h3><span>{avatar?.gestures.length ?? 0} ACTIVE</span></div>
              <div className="tag-list">
                {avatar?.gestures.length
                  ? avatar.gestures.map((gesture) => <span key={gesture.name}><Check size={12} />{gestureLabels[gesture.name]} {Math.round(gesture.confidence * 100)}%</span>)
                  : <span>等待动作</span>}
              </div>
              <p className="section-copy">支持挥手、双手举起、单手指向、双臂交叉、托腮、捂嘴、摸头、耸肩，以及前后左右侧倾。</p>
            </section>
            <section className="drawer-section">
              <h3>双手 21 点</h3>
              {(["left", "right"] as const).map((side) => {
                const hand = avatar?.hands[side];
                const label = side === "left" ? "左手" : "右手";
                return (
                  <div key={side} className="hand-monitor">
                    <StatRow label={label} value={hand?.present ? `${handGestureLabels[hand.gesture]} · ${Math.round(hand.confidence * 100)}%` : "未识别"} />
                    {hand?.present && (Object.entries(hand.fingerCurls) as Array<[keyof typeof hand.fingerCurls, number]>).map(([finger, value]) => (
                      <SignalBar key={finger} label={({ thumb: "拇指", index: "食指", middle: "中指", ring: "无名指", pinky: "小指" } as const)[finger]} value={value} />
                    ))}
                  </div>
                );
              })}
            </section>
            <section className="drawer-section">
              <h3>原始识别信号</h3>
              <SignalBar label="eyeBlinkLeft" value={raw.eyeBlinkLeft ?? 0} color="coral" />
              <SignalBar label="eyeBlinkRight" value={raw.eyeBlinkRight ?? 0} color="coral" />
              <SignalBar label="jawOpen" value={raw.jawOpen ?? 0} color="amber" />
              <SignalBar label="mouthSmile" value={((raw.mouthSmileLeft ?? 0) + (raw.mouthSmileRight ?? 0)) / 2} />
            </section>
            <section className="drawer-section">
              <div className="section-title-row"><h3>手动特效</h3><span>最高优先级</span></div>
              <div className="expression-grid">
                {taffyProfile.manualExpressions.map((name) => (
                  <button key={name} className={props.manualMorphs[name] ? "is-active" : ""} onClick={() => props.onManualMorphToggle(name)}>{name}</button>
                ))}
              </div>
            </section>
            {props.capabilities && props.capabilities.unmappedMorphs.length > 0 && (
              <details className="drawer-section">
                <summary>PMX 扩展形态键 · {props.capabilities.unmappedMorphs.length}</summary>
                <p className="section-copy">模型作者保留的备用嘴型、眨眼、材质和组合预设。按模型原名手动调用；同一时间尽量只开一个组合项。</p>
                <div className="expression-grid">
                  {props.capabilities.unmappedMorphs.map((name) => (
                    <button key={name} className={props.manualMorphs[name] ? "is-active" : ""} onClick={() => props.onManualMorphToggle(name)}>{name}</button>
                  ))}
                </div>
              </details>
            )}
            <label className="switch-row"><span><Eye size={16} />交换左右眼</span><input type="checkbox" checked={props.swapEyes} onChange={(event) => props.onSwapEyesChange(event.target.checked)} /></label>
            <button className="secondary-action full-width" onClick={props.onResetMotion}><RotateCcw size={16} />动作回到中立</button>
          </>
        )}

        {props.view === "performance" && (
          <>
            <section className="drawer-section">
              <h3>运行档位</h3>
              <div className="preset-stack">
                {([
                  ["light", "轻量", "20 FPS 面部 + 姿态 + 双手 · 低分辨率渲染"],
                  ["balanced", "均衡", "30 FPS 面部 + 姿态 + 双手 · 原生分辨率"],
                  ["high", "高质量", "30 FPS 面部 + 姿态 + 双手 · 更清晰舞台"]
                ] as Array<[QualityPreset, string, string]>).map(([value, label, detail]) => (
                  <button key={value} className={props.quality === value ? "is-active" : ""} onClick={() => props.onQualityChange(value)}>
                    <span className="radio-mark">{props.quality === value && <span />}</span>
                    <span><strong>{label}</strong><small>{detail}</small></span>
                  </button>
                ))}
              </div>
            </section>
            <section className="drawer-section">
              <h3>实时负载</h3>
              <StatRow label="捕获 / 推理" value={`${props.metrics.captureFps} / ${props.metrics.inferenceFps} FPS`} />
              <StatRow label="舞台渲染" value={`${props.metrics.renderFps} FPS`} />
              <StatRow label="推理耗时" value={`${props.metrics.inferenceMs} ms`} />
              <StatRow label="动作年龄" value={`${props.metrics.latencyMs} ms`} />
              <StatRow label="跳过帧" value={props.metrics.droppedFrames} />
              <StatRow label="人脸 / 上半身 / 手" value={`${props.metrics.facePresent ? "LOCK" : "—"} / ${props.metrics.posePresent ? "LOCK" : "—"} / ${props.metrics.handsPresent ? "LOCK" : "—"}`} />
              <StatRow label="捕捉后端" value={props.metrics.backend} />
            </section>
            <div className="info-callout"><Gauge size={18} /><p>过载时优先降低面捕频率，界面与舞台仍保持响应。</p></div>
          </>
        )}

        {props.view === "voice" && <VoiceControls {...props.voice} />}

        {props.view === "output" && (
          <>
            <section className="drawer-section">
              <h3>舞台背景</h3>
              <div className="background-grid">
                {([
                  ["studio", "导播台"], ["transparent", "透明"], ["green", "绿幕"], ["midnight", "纯黑"]
                ] as Array<[StageBackground, string]>).map(([value, label]) => (
                  <button key={value} className={`${props.background === value ? "is-active" : ""} bg-${value}`} onClick={() => props.onBackgroundChange(value)}><span />{label}</button>
                ))}
              </div>
            </section>
            <section className="drawer-section">
              <h3>本地录制</h3>
              <p className="section-copy">从虚拟舞台画布直接生成 WebM。录像只保存在浏览器内存，停止后由你下载。</p>
              <button className={props.recording ? "danger-action full-width" : "primary-action full-width"} onClick={props.onRecordingToggle}>
                <Video size={17} />{props.recording ? "停止并下载" : "开始录制舞台"}
              </button>
            </section>
            <div className="info-callout"><MonitorUp size={18} /><p>OBS 可用窗口捕获。透明通道与虚拟摄像头留给第二阶段桌面桥接器。</p></div>
          </>
        )}

        {props.view === "diagnostics" && (
          <>
            <div className="capability-banner is-ready"><Activity size={19} /><div><strong>诊断不包含图像</strong><span>不会记录摄像头帧或本机完整路径</span></div></div>
            <section className="drawer-section">
              <h3>最近事件</h3>
              {props.diagnostics.length === 0 ? <p className="muted-line">尚无错误事件。</p> : <ul className="log-list">{props.diagnostics.slice(-8).reverse().map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>}
            </section>
            <button className="secondary-action full-width" onClick={props.onExportDiagnostics}><Download size={16} />导出诊断 JSON</button>
          </>
        )}

        {props.view === "about" && (
          <>
            <div className="privacy-seal"><ShieldCheck size={30} /><div><strong>LOCAL PROCESSING</strong><span>摄像头、原声音频与模型均留在此设备</span></div></div>
            <section className="drawer-section credits-block">
              <h3>模型借物表</h3>
              <StatRow label="模型所属" value="永雏塔菲" />
              <StatRow label="建模" value="Francesca" />
              <StatRow label="绑定 / 表情" value="客官IIIII" />
              <p>本项目不附带、不上传该 PMX。公开发布或商用前，请另行确认权利人的完整使用条款。</p>
            </section>
            <section className="drawer-section credits-block">
              <h3>运行组件</h3>
              <p>MediaPipe Tasks Vision · Babylon.js · babylon-mmd · React · VCClient/RVC（外部本机服务）</p>
              <p>详细版权与许可见项目内 <code>THIRD_PARTY_NOTICES.md</code>。</p>
            </section>
            <div className="version-stamp"><BadgeInfo size={15} />TAFFY MOTION DEMO · v0.6.2</div>
          </>
        )}
      </div>
    </aside>
  );
}
