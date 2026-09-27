const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");

const DENOISE_LEVELS = new Set(["off", "light", "balanced", "strong"]);
const CHUNK_SIZES = new Set([48, 64, 96, 128, 192, 256]);

function finiteInRange(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : undefined;
}

function integerInRange(value, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : undefined;
}

function normalizeVoiceSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = {};
  const inputDeviceId = integerInRange(value.inputDeviceId, -1, 65535);
  const outputDeviceId = integerInRange(value.outputDeviceId, -1, 65535);
  const pitch = finiteInRange(value.pitch, -48, 48);
  const indexRatio = finiteInRange(value.indexRatio, 0, 1);
  const protect = finiteInRange(value.protect, 0, 0.5);
  const chunkSize = integerInRange(value.chunkSize, 1, 4096);
  const inputGain = finiteInRange(value.inputGain, 0, 4);
  const outputGain = finiteInRange(value.outputGain, 0, 4);

  if (inputDeviceId !== undefined) normalized.inputDeviceId = inputDeviceId;
  if (outputDeviceId !== undefined) normalized.outputDeviceId = outputDeviceId;
  if (typeof value.modelSlotIndex === "string" && value.modelSlotIndex.length <= 32) normalized.modelSlotIndex = value.modelSlotIndex;
  else {
    const modelSlotIndex = integerInRange(value.modelSlotIndex, 0, 4096);
    if (modelSlotIndex !== undefined) normalized.modelSlotIndex = modelSlotIndex;
  }
  if (pitch !== undefined) normalized.pitch = pitch;
  if (indexRatio !== undefined) normalized.indexRatio = indexRatio;
  if (protect !== undefined) normalized.protect = protect;
  if (chunkSize !== undefined && CHUNK_SIZES.has(chunkSize)) normalized.chunkSize = chunkSize;
  if (inputGain !== undefined) normalized.inputGain = inputGain;
  if (outputGain !== undefined) normalized.outputGain = outputGain;
  if (DENOISE_LEVELS.has(value.denoiseLevel)) normalized.denoiseLevel = value.denoiseLevel;

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function loadVoiceSettings(filePath) {
  try {
    const document = JSON.parse(readFileSync(filePath, "utf8"));
    return normalizeVoiceSettings(document?.settings ?? document);
  } catch {
    return null;
  }
}

function saveVoiceSettings(filePath, value) {
  const settings = normalizeVoiceSettings(value);
  if (!settings) throw new Error("声线配置无效，未写入磁盘。");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), settings }, null, 2)}\n`, "utf8");
  return settings;
}

module.exports = { loadVoiceSettings, normalizeVoiceSettings, saveVoiceSettings };
