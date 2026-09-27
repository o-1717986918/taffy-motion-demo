import type { TrackingFrame, TrackingProvider } from "../core/contracts";
import type { HandWorkerFrame, PoseWorkerFrame, WorkerRequest, WorkerResponse } from "./worker-protocol";

export interface TrackerStats {
  backend: string;
  inferenceFps: number;
  inferenceMs: number;
  droppedFrames: number;
}

type WorkerRole = "face" | "pose" | "hand";
type PendingFrame = {
  captureTimeMs: number;
  face: TrackingFrame | null;
  pose: PoseWorkerFrame | null;
  hand: HandWorkerFrame | null;
};

export class MediaPipeFaceProvider implements TrackingProvider {
  readonly id = "mediapipe-face-pose-hands";
  private faceWorker: Worker | null = null;
  private poseWorker: Worker | null = null;
  private handWorker: Worker | null = null;
  private ready = false;
  private inFlight = false;
  private pending: PendingFrame | null = null;
  private listeners = new Set<(frame: TrackingFrame) => void>();
  private frameTimes: number[] = [];
  private stats: TrackerStats = { backend: "—", inferenceFps: 0, inferenceMs: 0, droppedFrames: 0 };
  private errorListener: ((message: string) => void) | null = null;

  async start(): Promise<void> {
    if (this.faceWorker && this.poseWorker && this.handWorker && this.ready) return;
    if (this.faceWorker || this.poseWorker || this.handWorker) await this.stop();
    this.faceWorker = new Worker(new URL("./face-landmarker.worker.ts", import.meta.url), { type: "module" });
    this.poseWorker = new Worker(new URL("./pose-landmarker.worker.ts", import.meta.url), { type: "module" });
    this.handWorker = new Worker(new URL("./hand-landmarker.worker.ts", import.meta.url), { type: "module" });
    try {
      const [faceBackend, poseBackend, handBackend] = await Promise.all([
        this.initializeWorker(this.faceWorker, "face", `${location.origin}/runtime/face_landmarker.task`),
        this.initializeWorker(this.poseWorker, "pose", `${location.origin}/runtime/pose_landmarker_full.task`),
        this.initializeWorker(this.handWorker, "hand", `${location.origin}/runtime/hand_landmarker.task`)
      ]);
      this.stats.backend = `${faceBackend}/${poseBackend}/${handBackend} · FACE+POSE+HANDS`;
      this.ready = true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    for (const worker of [this.faceWorker, this.poseWorker, this.handWorker]) {
      if (!worker) continue;
      const request: WorkerRequest = { kind: "dispose" };
      worker.postMessage(request);
      worker.terminate();
    }
    this.faceWorker = null;
    this.poseWorker = null;
    this.handWorker = null;
    this.ready = false;
    this.inFlight = false;
    this.pending = null;
    this.frameTimes = [];
  }

  submit(image: ImageBitmap, captureTimeMs: number): boolean {
    if (!this.faceWorker || !this.poseWorker || !this.handWorker || !this.ready || this.inFlight) {
      image.close();
      this.stats.droppedFrames += 1;
      return false;
    }
    this.inFlight = true;
    this.pending = { captureTimeMs, face: null, pose: null, hand: null };
    void this.dispatch(image, captureTimeMs);
    return true;
  }

  onFrame(callback: (frame: TrackingFrame) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onError(callback: (message: string) => void): () => void {
    this.errorListener = callback;
    return () => {
      if (this.errorListener === callback) this.errorListener = null;
    };
  }

  getStats(): TrackerStats {
    return { ...this.stats };
  }

  private initializeWorker(worker: Worker, role: WorkerRole, modelPath: string): Promise<"GPU" | "CPU"> {
    return new Promise((resolve, reject) => {
      const roleName = role === "face" ? "面部" : role === "pose" ? "姿态" : "手部";
      const timeout = window.setTimeout(() => reject(new Error(`${roleName}捕捉初始化超时。`)), 30000);
      worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
        const message = event.data;
        if (message.kind === "ready") {
          window.clearTimeout(timeout);
          resolve(message.backend);
        } else if (message.kind === "frame" && role === "face") {
          this.handleFaceFrame(message.frame);
        } else if (message.kind === "pose-frame" && role === "pose") {
          this.handlePoseFrame(message.frame);
        } else if (message.kind === "hand-frame" && role === "hand") {
          this.handleHandFrame(message.frame);
        } else if (message.kind === "error") {
          this.handleWorkerError(`${roleName}捕捉：${message.message}`);
          if (message.fatal) {
            window.clearTimeout(timeout);
            reject(new Error(message.message));
          }
        }
      };
      worker.onerror = (event): void => this.handleWorkerError(event.message || `${role} Worker 发生未知错误。`);
      const request: WorkerRequest = {
        kind: "initialize",
        wasmRoot: `${location.origin}/runtime/wasm`,
        modelPath
      };
      worker.postMessage(request);
    });
  }

  private async dispatch(image: ImageBitmap, captureTimeMs: number): Promise<void> {
    try {
      const [poseImage, handImage] = await Promise.all([createImageBitmap(image), createImageBitmap(image)]);
      if (!this.faceWorker || !this.poseWorker || !this.handWorker || !this.ready || this.pending?.captureTimeMs !== captureTimeMs) {
        image.close();
        poseImage.close();
        handImage.close();
        return;
      }
      const faceRequest: WorkerRequest = { kind: "detect", image, captureTimeMs, sentTimeMs: performance.now() };
      const poseRequest: WorkerRequest = { kind: "detect", image: poseImage, captureTimeMs, sentTimeMs: performance.now() };
      const handRequest: WorkerRequest = { kind: "detect", image: handImage, captureTimeMs, sentTimeMs: performance.now() };
      this.faceWorker.postMessage(faceRequest, [image]);
      this.poseWorker.postMessage(poseRequest, [poseImage]);
      this.handWorker.postMessage(handRequest, [handImage]);
    } catch (error) {
      image.close();
      this.handleWorkerError(error instanceof Error ? error.message : String(error));
    }
  }

  private handleFaceFrame(frame: TrackingFrame): void {
    if (!this.pending || this.pending.captureTimeMs !== frame.captureTimeMs) return;
    this.pending.face = frame;
    this.emitPendingFrame();
  }

  private handlePoseFrame(frame: PoseWorkerFrame): void {
    if (!this.pending || this.pending.captureTimeMs !== frame.captureTimeMs) return;
    this.pending.pose = frame;
    this.emitPendingFrame();
  }

  private handleHandFrame(frame: HandWorkerFrame): void {
    if (!this.pending || this.pending.captureTimeMs !== frame.captureTimeMs) return;
    this.pending.hand = frame;
    this.emitPendingFrame();
  }

  private emitPendingFrame(): void {
    const pending = this.pending;
    if (!pending?.face || !pending.pose || !pending.hand) return;
    const frame: TrackingFrame = {
      ...pending.face,
      producedTimeMs: Math.max(pending.face.producedTimeMs, pending.pose.producedTimeMs),
      inferenceTimeMs: Math.max(pending.face.inferenceTimeMs, pending.pose.inferenceTimeMs, pending.hand.inferenceTimeMs),
      pose: pending.pose.pose,
      hands: pending.hand.hands
    };
    this.pending = null;
    this.inFlight = false;
    const now = performance.now();
    this.frameTimes.push(now);
    while (this.frameTimes.length > 1 && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
    this.stats.inferenceFps = this.frameTimes.length;
    this.stats.inferenceMs = frame.inferenceTimeMs;
    for (const listener of this.listeners) listener(frame);
  }

  private handleWorkerError(message: string): void {
    this.inFlight = false;
    this.pending = null;
    this.errorListener?.(message);
  }
}
