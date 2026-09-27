import { copyFile, mkdir, access, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSource = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmTarget = resolve(root, "public/runtime/wasm");
const models = [
  {
    name: "Face Landmarker",
    target: resolve(root, "public/runtime/face_landmarker.task"),
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
  },
  {
    name: "Pose Landmarker Full",
    target: resolve(root, "public/runtime/pose_landmarker_full.task"),
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
  },
  {
    name: "Hand Landmarker",
    target: resolve(root, "public/runtime/hand_landmarker.task"),
    url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
  }
];
const runtimeFiles = [
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm"
];

await mkdir(wasmTarget, { recursive: true });
for (const file of runtimeFiles) {
  await copyFile(resolve(wasmSource, file), resolve(wasmTarget, file));
}

for (const staleFile of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm"
]) {
  await rm(resolve(wasmTarget, staleFile), { force: true });
}

for (const model of models) {
  try {
    await access(model.target);
  } catch {
    const response = await fetch(model.url);
    if (!response.ok) throw new Error(`${model.name} 模型下载失败：${response.status}`);
    await writeFile(model.target, new Uint8Array(await response.arrayBuffer()));
  }
}

console.log("MediaPipe 本地运行资源已同步。");
