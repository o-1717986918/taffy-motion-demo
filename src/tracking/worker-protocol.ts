import type { QuaternionTuple, TrackingFrame } from "../core/contracts";

export type WorkerRequest =
  | { kind: "initialize"; wasmRoot: string; modelPath: string }
  | { kind: "detect"; image: ImageBitmap; captureTimeMs: number; sentTimeMs: number }
  | { kind: "dispose" };

export interface PoseWorkerFrame {
  captureTimeMs: number;
  producedTimeMs: number;
  inferenceTimeMs: number;
  pose: NonNullable<TrackingFrame["pose"]>;
}

export interface HandWorkerFrame {
  captureTimeMs: number;
  producedTimeMs: number;
  inferenceTimeMs: number;
  hands: NonNullable<TrackingFrame["hands"]>;
}

export type WorkerResponse =
  | { kind: "ready"; backend: "GPU" | "CPU" }
  | { kind: "frame"; frame: TrackingFrame }
  | { kind: "pose-frame"; frame: PoseWorkerFrame }
  | { kind: "hand-frame"; frame: HandWorkerFrame }
  | { kind: "error"; message: string; fatal: boolean };

export interface SerializedFace {
  present: boolean;
  confidence: number;
  headRotation: QuaternionTuple;
  headPosition?: [number, number, number];
  gaze: { left: [number, number]; right: [number, number] };
  blendshapes: Record<string, number>;
  landmarks: Float32Array;
}
