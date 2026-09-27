const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const avatarSourceValue = process.env.TAFFY_AVATAR_MODEL_DIR;
const voiceRuntimeValue = process.env.TAFFY_VCCLIENT_DIR;
if (!avatarSourceValue || !voiceRuntimeValue) {
  throw new Error("Set TAFFY_AVATAR_MODEL_DIR and TAFFY_VCCLIENT_DIR to asset/runtime folders you are allowed to use.");
}
const avatarSource = resolve(avatarSourceValue);
const voiceRuntimeSource = resolve(voiceRuntimeValue);
const output = resolve(process.env.TAFFY_DESKTOP_OUTPUT ?? "build/desktop");
const avatarManifestPath = resolve("desktop/avatar-manifest.json");
const voiceManifestPath = resolve("desktop/voice-model-manifest.json");

for (const [label, path] of [["Avatar model", avatarSource], ["VCClient runtime", voiceRuntimeSource]]) {
  if (!existsSync(path)) throw new Error(`${label} 资源不存在：${path}`);
}
for (const [label, path] of [["Avatar manifest", avatarManifestPath], ["Voice model manifest", voiceManifestPath]]) {
  if (!existsSync(path)) throw new Error(`${label} missing. Copy the matching .example.json file and configure your own assets.`);
}

const avatarManifest = JSON.parse(readFileSync(avatarManifestPath, "utf8"));
const voiceManifest = JSON.parse(readFileSync(voiceManifestPath, "utf8"));
if (!avatarManifest.model || !Array.isArray(avatarManifest.files) || !voiceManifest.model?.name || !voiceManifest.index?.name) {
  throw new Error("Local asset manifests are invalid. See desktop/*.example.json.");
}
for (const path of [avatarManifest.model, ...avatarManifest.files.map((file) => file.path)]) {
  const asset = resolve(avatarSource, path);
  if (!asset.startsWith(`${avatarSource}\\`) || !existsSync(asset)) throw new Error(`Avatar asset is missing or invalid: ${path}`);
}
for (const path of [voiceManifest.model.name, voiceManifest.index.name]) {
  const asset = resolve(voiceRuntimeSource, "model_dir", String(voiceManifest.slotIndex ?? 168), path);
  if (!asset.startsWith(`${voiceRuntimeSource}\\`) || !existsSync(asset)) throw new Error(`Voice model asset is missing or invalid: ${path}`);
}

module.exports = {
  appId: "local.virtual.avatar.motion.demo",
  productName: "Virtual Avatar Motion Demo",
  electronDist: resolve("node_modules/electron/dist"),
  asar: true,
  compression: "store",
  npmRebuild: false,
  directories: { output },
  files: [
    "dist/**/*",
    "desktop/*.cjs",
    "desktop/avatar-manifest.json",
    "desktop/voice-model-manifest.json",
    "package.json",
    "README.md",
    "THIRD_PARTY_NOTICES.md"
  ],
  extraResources: [
    {
      from: avatarSource,
      to: "taffy-avatar",
      filter: ["**/*"]
    },
    {
      from: voiceRuntimeSource,
      to: "vcclient",
      filter: [
        "**/*",
        "!model_dir/169{,/**/*}",
        "!tmp_dir{,/**/*}",
        "!upload_dir{,/**/*}",
        "!**/*.log"
      ]
    }
  ],
  extraFiles: [
    { from: "desktop/使用说明.txt", to: "使用说明.txt" },
    { from: "THIRD_PARTY_NOTICES.md", to: "THIRD_PARTY_NOTICES.md" }
  ],
  win: {
    executableName: "TaffyMotion",
    target: [{ target: "dir", arch: ["x64"] }]
  }
};
