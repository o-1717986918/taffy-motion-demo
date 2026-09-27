import { useEffect, useRef, type RefObject } from "react";
import { Expand, FolderOpen, Orbit, RadioTower, SlidersHorizontal } from "lucide-react";
import { PmxAvatarAdapter, type StageBackground } from "../avatar/PmxAvatarAdapter";
import type { MotionBus } from "../core/MotionBus";
import type { ModelCapabilities } from "../core/contracts";
import { IconButton } from "./IconButton";

interface AvatarPanelProps {
  panelRef: RefObject<HTMLElement | null>;
  bus: MotionBus;
  capabilities: ModelCapabilities | null;
  loading: boolean;
  background: StageBackground;
  onReady: (adapter: PmxAvatarAdapter) => void;
  onChooseModel: () => void;
  onOpenOutput: () => void;
  onFullscreen: () => void;
}

export function AvatarPanel(props: AvatarPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adapterRef = useRef<PmxAvatarAdapter | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const adapter = new PmxAvatarAdapter(canvasRef.current);
    adapterRef.current = adapter;
    props.onReady(adapter);
    const unsubscribe = props.bus.subscribe((_raw, avatar) => adapter.setLatestFrame(avatar));
    return () => {
      unsubscribe();
      void adapter.dispose();
      adapterRef.current = null;
    };
  }, [props.bus, props.onReady]);

  useEffect(() => adapterRef.current?.setBackground(props.background), [props.background]);

  return (
    <section ref={props.panelRef} className="feed-panel avatar-panel" aria-label="虚拟形象">
      <header className="panel-header">
        <div>
          <span className="panel-kicker">PROGRAM / 02</span>
          <h2>虚拟形象</h2>
        </div>
        <div className={`signal-pill ${props.capabilities ? "is-ready" : ""}`}>
          <span className="signal-dot" />{props.capabilities ? "PMX READY" : "NO MODEL"}
        </div>
      </header>

      <div className={`avatar-viewport stage-${props.background}`}>
        <canvas ref={canvasRef} className="avatar-canvas" aria-label="PMX 虚拟形象舞台" />
        {!props.capabilities && (
          <div className="panel-empty panel-empty--avatar">
            <div className="avatar-silhouette" aria-hidden="true">
              <span className="avatar-head" />
              <span className="avatar-body" />
            </div>
            <p className="empty-eyebrow">本机 PMX 舞台</p>
            <h3>{props.loading ? "正在编译材质…" : "让角色进入镜头"}</h3>
            <p>请选择包含 PMX 与 Tex 贴图的整个模型文件夹。</p>
            <button className="primary-action" onClick={props.onChooseModel} disabled={props.loading}>
              <FolderOpen size={17} />{props.loading ? "正在加载…" : "选择模型文件夹"}
            </button>
          </div>
        )}
        <div className="stage-ruler" aria-hidden="true"><span /><span /><span /><span /><span /></div>
        {props.capabilities && (
          <div className="viewport-hud viewport-hud--right">
            <span><RadioTower size={13} /> MOTION BUS</span>
            <span>{props.capabilities.displayName}</span>
          </div>
        )}
      </div>

      <footer className="panel-controls">
        <div className="model-caption">
          <strong>{props.capabilities?.displayName ?? "未载入模型"}</strong>
          <span>{props.capabilities ? `${props.capabilities.boneCount} 骨骼 · ${props.capabilities.morphCount} 形态键` : "PMX / PMD FILE API"}</span>
        </div>
        <div className="control-cluster">
          <IconButton compact icon={<SlidersHorizontal size={17} />} label="舞台输出" onClick={props.onOpenOutput} />
          <IconButton compact icon={<Orbit size={17} />} label="重置视角" onClick={() => adapterRef.current?.resetCamera()} />
          <IconButton compact icon={<Expand size={17} />} label="虚拟形象全屏" onClick={props.onFullscreen} />
        </div>
      </footer>
    </section>
  );
}
