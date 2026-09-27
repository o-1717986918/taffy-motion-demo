import { useEffect, useRef, type RefObject } from "react";
import { Activity, Camera, CameraOff, Focus, Hand, Maximize2, ScanFace, Sparkles } from "lucide-react";
import type { MotionBus } from "../core/MotionBus";
import { OverlayRenderer, type OverlayOptions } from "../overlay/OverlayRenderer";
import { IconButton } from "./IconButton";

interface CameraPanelProps {
  panelRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  bus: MotionBus;
  options: OverlayOptions;
  onOptionsChange: (options: OverlayOptions) => void;
  running: boolean;
  busy: boolean;
  error: string | null;
  devices: MediaDeviceInfo[];
  selectedDevice: string;
  onDeviceChange: (deviceId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onFullscreen: () => void;
}

export function CameraPanel(props: CameraPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !props.videoRef.current) return;
    const renderer = new OverlayRenderer(canvasRef.current, props.videoRef.current);
    const unsubscribe = props.bus.subscribe((raw, avatar) => renderer.draw(raw, avatar, props.options));
    if (!props.options.enabled) renderer.clear();
    return unsubscribe;
  }, [props.bus, props.options, props.videoRef]);

  const setOption = (key: keyof OverlayOptions, value: boolean) =>
    props.onOptionsChange({ ...props.options, [key]: value });

  return (
    <section ref={props.panelRef} className="feed-panel camera-panel" aria-label="现实画面">
      <header className="panel-header">
        <div>
          <span className="panel-kicker">INPUT / 01</span>
          <h2>现实画面</h2>
        </div>
        <div className={`signal-pill ${props.running ? "is-live" : ""}`}>
          <span className="signal-dot" />{props.running ? "LIVE" : "STANDBY"}
        </div>
      </header>

      <div className="camera-viewport">
        <video
          ref={props.videoRef}
          className={props.options.mirrored ? "is-mirrored" : ""}
          muted
          playsInline
          aria-label="摄像头实时画面"
        />
        <canvas ref={canvasRef} className="overlay-canvas" />

        {!props.running && (
          <div className="panel-empty">
            <div className="empty-reticle"><Camera size={30} strokeWidth={1.5} /></div>
            <p className="empty-eyebrow">本地视频源</p>
            <h3>{props.error ? "摄像头未能启动" : "等待摄像头许可"}</h3>
            <p>{props.error ?? "画面只在此设备上进入面捕 Worker，不会上传。"}</p>
            <button className="primary-action" onClick={props.onStart} disabled={props.busy}>
              <Camera size={17} />{props.busy ? "正在初始化…" : "启动摄像头"}
            </button>
          </div>
        )}

        {props.running && (
          <div className="viewport-hud viewport-hud--left">
            <span><ScanFace size={13} /> 478 FACE + 33 POSE + 2×21 HAND</span>
            <span>LOCAL ONLY</span>
          </div>
        )}
      </div>

      <footer className="panel-controls">
        <div className="control-cluster">
          <IconButton
            compact
            icon={props.running ? <CameraOff size={17} /> : <Camera size={17} />}
            label={props.running ? "关闭摄像头" : "启动摄像头"}
            onClick={props.running ? props.onStop : props.onStart}
            disabled={props.busy}
          />
          <select
            className="device-select"
            aria-label="选择摄像头"
            value={props.selectedDevice}
            onChange={(event) => props.onDeviceChange(event.target.value)}
            disabled={!props.running || props.devices.length === 0}
          >
            {props.devices.length === 0 && <option value="">默认摄像头</option>}
            {props.devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>{device.label || `摄像头 ${index + 1}`}</option>
            ))}
          </select>
        </div>
        <div className="control-cluster">
          <IconButton compact icon={<ScanFace size={17} />} label="面部线条" active={props.options.enabled} onClick={() => setOption("enabled", !props.options.enabled)} />
          <IconButton compact icon={<Activity size={17} />} label="上半身骨架" active={props.options.pose} onClick={() => setOption("pose", !props.options.pose)} disabled={!props.options.enabled} />
          <IconButton compact icon={<Hand size={17} />} label="双手关键点" active={props.options.hands} onClick={() => setOption("hands", !props.options.hands)} disabled={!props.options.enabled} />
          <IconButton compact icon={<Sparkles size={17} />} label="完整网格" active={props.options.mesh} onClick={() => setOption("mesh", !props.options.mesh)} disabled={!props.options.enabled} />
          <IconButton compact icon={<Focus size={17} />} label="关键点" active={props.options.points} onClick={() => setOption("points", !props.options.points)} disabled={!props.options.enabled} />
          <IconButton compact icon={<Maximize2 size={17} />} label="现实画面全屏" onClick={props.onFullscreen} />
        </div>
      </footer>
    </section>
  );
}
