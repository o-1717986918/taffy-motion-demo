/// <reference lib="webworker" />

import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

declare const self: DedicatedWorkerGlobalScope;

let landmarker: PoseLandmarker | null = null;
let backend: "GPU" | "CPU" = "CPU";

const send = (message: WorkerResponse, transfer: Transferable[] = []): void => self.postMessage(message, transfer);

async function initialize(wasmRoot: string, modelPath: string): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(wasmRoot, true);
  const create = (delegate: "GPU" | "CPU") => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.35,
    minPosePresenceConfidence: 0.3,
    minTrackingConfidence: 0.4,
    outputSegmentationMasks: false
  });
  try {
    landmarker = await create("GPU");
    backend = "GPU";
  } catch {
    landmarker = await create("CPU");
    backend = "CPU";
  }
  send({ kind: "ready", backend });
}

function detect(image: ImageBitmap, captureTimeMs: number, sentTimeMs: number): void {
  if (!landmarker) {
    image.close();
    send({ kind: "error", message: "Pose Landmarker 尚未就绪。", fatal: false });
    return;
  }
  const started = performance.now();
  try {
    const result = landmarker.detectForVideo(image, Math.max(0, captureTimeMs));
    const posePoints = result.landmarks?.[0] ?? [];
    const worldPoints = result.worldLandmarks?.[0] ?? [];
    const serialize = (points: typeof posePoints): Float32Array => {
      const values = new Float32Array(points.length * 4);
      for (let index = 0; index < points.length; index += 1) {
        values[index * 4] = points[index].x;
        values[index * 4 + 1] = points[index].y;
        values[index * 4 + 2] = points[index].z;
        values[index * 4 + 3] = points[index].visibility ?? 0;
      }
      return values;
    };
    const landmarks = serialize(posePoints);
    const worldLandmarks = serialize(worldPoints);
    // Chest-up streaming shots often crop both hips. Shoulders are the only
    // required anchors; elbows, wrists and hips improve the result when visible.
    const upperBodyIndices = [11, 12, 13, 14, 15, 16];
    const visibility = upperBodyIndices
      .map((index) => posePoints[index]?.visibility ?? 0)
      .filter((value) => value >= 0.05);
    const confidence = visibility.length ? visibility.reduce((sum, value) => sum + value, 0) / visibility.length : 0;
    const shouldersPresent = [11, 12].every((index) => (posePoints[index]?.visibility ?? 0) >= 0.22);
    const now = performance.now();
    void sentTimeMs;
    send({
      kind: "pose-frame",
      frame: {
        captureTimeMs,
        producedTimeMs: now,
        inferenceTimeMs: now - started,
        pose: { present: posePoints.length >= 17 && shouldersPresent, confidence, landmarks, worldLandmarks }
      }
    }, [landmarks.buffer, worldLandmarks.buffer]);
  } catch (error) {
    send({ kind: "error", message: error instanceof Error ? error.message : String(error), fatal: false });
  } finally {
    image.close();
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data;
  if (request.kind === "initialize") {
    initialize(request.wasmRoot, request.modelPath).catch((error) => {
      send({ kind: "error", message: error instanceof Error ? error.message : String(error), fatal: true });
    });
  } else if (request.kind === "detect") {
    detect(request.image, request.captureTimeMs, request.sentTimeMs);
  } else {
    landmarker?.close();
    landmarker = null;
    self.close();
  }
};
