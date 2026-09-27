import type { ModelSource } from "../core/contracts";

interface BundledAvatarManifest {
  schemaVersion: 1;
  displayName: string;
  model: string;
  files: Array<{ path: string; bytes: number }>;
}

const assetUrl = (relativePath: string): string =>
  `/__taffy_avatar/files/${relativePath.split("/").map(encodeURIComponent).join("/")}`;

const asFolderFile = (blob: Blob, relativePath: string): File => {
  const name = relativePath.split("/").pop() ?? relativePath;
  const file = new File([blob], name, { type: blob.type, lastModified: 0 });
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: `taffy-avatar/${relativePath}`
  });
  return file;
};

export async function loadBundledAvatarModel(): Promise<ModelSource> {
  const response = await fetch("/__taffy_avatar/manifest.json", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`内置 PMX 清单不可用：HTTP ${response.status}。`);
  const manifest = await response.json() as BundledAvatarManifest;
  if (manifest.schemaVersion !== 1 || !manifest.model || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("内置 PMX 清单格式无效。");
  }

  const referenceFiles = await Promise.all(manifest.files.map(async (entry) => {
    if (!entry.path || entry.path.includes("..") || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error("内置 PMX 清单包含无效文件。");
    }
    const assetResponse = await fetch(assetUrl(entry.path));
    if (!assetResponse.ok) throw new Error(`读取内置模型文件失败：${entry.path}（HTTP ${assetResponse.status}）。`);
    const blob = await assetResponse.blob();
    if (blob.size !== entry.bytes) throw new Error(`内置模型文件大小不匹配：${entry.path}。`);
    return asFolderFile(blob, entry.path);
  }));
  const modelFile = referenceFiles.find((file) => file.webkitRelativePath === `taffy-avatar/${manifest.model}`);
  if (!modelFile) throw new Error("内置 PMX 主文件缺失。");
  return { modelFile, referenceFiles };
}
