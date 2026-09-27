/// <reference lib="webworker" />

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Handedness } from "../core/contracts";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

declare const self: DedicatedWorkerGlobalScope;

let landmarker: HandLandmarker | null = null;
let backend: "GPU" | "CPU" = "CPU";

const send = (message: WorkerResponse, transfer: Transferable[] = []): void => self.postMessage(message, transfer);

async function initialize(wasmRoot: string, modelPath: string): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(wasmRoot, true);
  const create = (delegate: "GPU" | "CPU") => HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath, delegate },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.42,
    minHandPresenceConfidence: 0.38,
    minTrackingConfidence: 0.42
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
    send({ kind: "error", message: "Hand Landmarker 尚未就绪。", fatal: false });
    return;
  }
  const started = performance.now();
  try {
    const result = landmarker.detectForVideo(image, Math.max(0, captureTimeMs));
    const buffers: ArrayBuffer[] = [];
    const hands = (result.landmarks ?? []).map((points, index) => {
      const serialize = (source: typeof points): Float32Array => {
        const values = new Float32Array(source.length * 4);
        for (let pointIndex = 0; pointIndex < source.length; pointIndex += 1) {
          values[pointIndex * 4] = source[pointIndex].x;
          values[pointIndex * 4 + 1] = source[pointIndex].y;
          values[pointIndex * 4 + 2] = source[pointIndex].z;
          values[pointIndex * 4 + 3] = 1;
        }
        buffers.push(values.buffer);
        return values;
      };
      const category = result.handedness?.[index]?.[0];
      // Handedness assumes a mirrored selfie. The worker receives unmirrored
      // camera pixels, so normalize to the person's real anatomical side first.
      const label: Handedness = category?.categoryName === "Right" ? "Left" : "Right";
      return {
        handedness: label,
        confidence: category?.score ?? 0,
        landmarks: serialize(points),
        worldLandmarks: serialize(result.worldLandmarks?.[index] ?? [])
      };
    });
    const now = performance.now();
    void sentTimeMs;
    send({
      kind: "hand-frame",
      frame: { captureTimeMs, producedTimeMs: now, inferenceTimeMs: now - started, hands }
    }, buffers);
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
