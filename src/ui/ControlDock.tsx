import {
  Activity,
  AudioLines,
  CircleGauge,
  FolderSync,
  Info,
  Mic2,
  ScanFace,
  SlidersHorizontal
} from "lucide-react";
import type { DrawerView } from "../core/contracts";

interface ControlDockProps {
  activeView: DrawerView | null;
  cameraRunning: boolean;
  facePresent: boolean;
  calibrationProgress: number;
  onCalibrate: () => void;
  onChooseModel: () => void;
  onOpen: (view: DrawerView) => void;
}

export function ControlDock(props: ControlDockProps) {
  const actions: Array<{ view: DrawerView; icon: typeof Activity; label: string }> = [
    { view: "expressions", icon: AudioLines, label: "表情映射" },
    { view: "voice", icon: Mic2, label: "变声器" },
    { view: "performance", icon: CircleGauge, label: "性能" },
    { view: "output", icon: SlidersHorizontal, label: "输出" },
    { view: "diagnostics", icon: Activity, label: "诊断" },
    { view: "about", icon: Info, label: "关于" }
  ];
  return (
    <nav className="control-dock" aria-label="主控制栏">
      <button
        className={`dock-primary ${props.calibrationProgress > 0 ? "is-calibrating" : ""}`}
        onClick={props.onCalibrate}
        disabled={!props.cameraRunning || !props.facePresent}
      >
        <span className="dock-icon"><ScanFace size={19} /></span>
        <span><strong>{props.calibrationProgress > 0 ? `校准 ${Math.round(props.calibrationProgress * 100)}%` : "中立校准"}</strong><small>{props.facePresent ? "正视镜头 2 秒" : "检测到脸后可用"}</small></span>
        {props.calibrationProgress > 0 && <i style={{ width: `${props.calibrationProgress * 100}%` }} />}
      </button>
      <span className="dock-divider" />
      <button className="dock-action" onClick={props.onChooseModel}><FolderSync size={18} /><span>换模型</span></button>
      {actions.map(({ view, icon: Icon, label }) => (
        <button key={view} className={`dock-action ${props.activeView === view ? "is-active" : ""}`} onClick={() => props.onOpen(view)}><Icon size={18} /><span>{label}</span></button>
      ))}
    </nav>
  );
}
