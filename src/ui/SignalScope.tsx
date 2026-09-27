import { useEffect, useRef } from "react";
import type { MotionBus } from "../core/MotionBus";

interface SignalSample {
  blink: number;
  mouth: number;
  yaw: number;
}

export function SignalScope({ bus }: { bus: MotionBus }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samplesRef = useRef<SignalSample[]>([]);

  useEffect(() => bus.subscribe((_raw, avatar) => {
    const samples = samplesRef.current;
    samples.push({
      blink: avatar.morphs.blinkBoth ?? Math.max(avatar.morphs.blinkLeft ?? 0, avatar.morphs.blinkRight ?? 0),
      mouth: avatar.morphs.mouthA ?? 0,
      yaw: avatar.headEuler.yaw / 0.72 / 2 + 0.5
    });
    if (samples.length > 84) samples.splice(0, samples.length - 84);
  }), [bus]);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width * devicePixelRatio));
        const height = Math.max(1, Math.round(rect.height * devicePixelRatio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const context = canvas.getContext("2d");
        if (context) {
          context.clearRect(0, 0, width, height);
          context.strokeStyle = "rgba(73, 62, 104, 0.12)";
          context.lineWidth = devicePixelRatio;
          for (let row = 1; row < 4; row += 1) {
            context.beginPath();
            context.moveTo(0, height * row / 4);
            context.lineTo(width, height * row / 4);
            context.stroke();
          }
          const series: Array<{ key: keyof SignalSample; color: string }> = [
            { key: "blink", color: "#ff7f92" },
            { key: "mouth", color: "#f3c77e" },
            { key: "yaw", color: "#b9a4ff" }
          ];
          for (const line of series) {
            context.beginPath();
            samplesRef.current.forEach((sample, index, all) => {
              const x = all.length <= 1 ? width : index / (all.length - 1) * width;
              const y = height - sample[line.key] * height;
              if (index === 0) context.moveTo(x, y);
              else context.lineTo(x, y);
            });
            context.strokeStyle = line.color;
            context.lineWidth = 1.5 * devicePixelRatio;
            context.stroke();
          }
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} className="signal-scope" aria-label="实时动作信号示波器" />;
}
