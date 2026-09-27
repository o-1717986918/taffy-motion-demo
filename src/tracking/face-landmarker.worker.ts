/// <reference lib="webworker" />

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { quaternionFromMatrix } from "../core/math";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

declare const self: DedicatedWorkerGlobalScope;

let landmarker: FaceLandmarker | null = null;
let backend: "GPU" | "CPU" = "CPU";

const send = (message: WorkerResponse, transfer: Transferable[] = []): void => self.postMessage(message, transfer);

const gazeAxis = (shapes: Record<string, number>, side: "Left" | "Right"): [number, number] => {
  const inward = shapes[`eyeLookIn${side}`] ?? 0;
  const outward = shapes[`eyeLookOut${side}`] ?? 0;
  const up = shapes[`eyeLookUp${side}`] ?? 0;
  const down = shapes[`eyeLookDown${side}`] ?? 0;
  const horizontal = side === "Left" ? outward - inward : inward - outward;
  return [Math.max(-1, Math.min(1, horizontal)), Math.max(-1, Math.min(1, down - up))];
};

async function initialize(wasmRoot: string, modelPath: string): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(wasmRoot, true);
  const create = (delegate: "GPU" | "CPU") => FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.58,
    minFacePresenceConfidence: 0.58,
    minTrackingConfidence: 0.55,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true
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
    send({ kind: "error", message: "Face Landmarker 尚未就绪。", fatal: false });
    return;
  }
  const started = performance.now();
  try {
    const result = landmarker.detectForVideo(image, Math.max(0, captureTimeMs));
    const facePoints = result.faceLandmarks?.[0] ?? [];
    const landmarks = new Float32Array(facePoints.length * 3);
    for (let index = 0; index < facePoints.length; index += 1) {
      landmarks[index * 3] = facePoints[index].x;
      landmarks[index * 3 + 1] = facePoints[index].y;
      landmarks[index * 3 + 2] = facePoints[index].z;
    }
    const blendshapes = Object.fromEntries(
      (result.faceBlendshapes?.[0]?.categories ?? []).map((category) => [category.categoryName, category.score])
    );
    const transformation = result.facialTransformationMatrixes?.[0] as unknown as { data?: ArrayLike<number> } | undefined;
    const matrix = transformation?.data ?? [];
    const present = facePoints.length > 0;
    const now = performance.now();
    const frame = {
      schemaVersion: 1 as const,
      source: "mediapipe-face" as const,
      captureTimeMs,
      producedTimeMs: now,
      inferenceTimeMs: now - started,
      face: {
        present,
        confidence: present ? 1 : 0,
        headRotation: matrix.length >= 16 ? quaternionFromMatrix(matrix) : [0, 0, 0, 1] as [number, number, number, number],
        headPosition: matrix.length >= 16 ? [matrix[12], matrix[13], matrix[14]] as [number, number, number] : undefined,
        gaze: { left: gazeAxis(blendshapes, "Left"), right: gazeAxis(blendshapes, "Right") },
        blendshapes,
        landmarks
      }
    };
    void sentTimeMs;
    send({ kind: "frame", frame }, [landmarks.buffer]);
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
