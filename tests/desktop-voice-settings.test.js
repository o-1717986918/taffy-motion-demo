import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { loadVoiceSettings, normalizeVoiceSettings, saveVoiceSettings } = require("../desktop/voice-settings-store.cjs");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("desktop voice settings store", () => {
  it("round-trips all user-controlled voice parameters", () => {
    const directory = mkdtempSync(join(tmpdir(), "taffy-voice-settings-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "nested", "voice-settings.json");
    const settings = {
      inputDeviceId: 91,
      outputDeviceId: 72,
      modelSlotIndex: 168,
      pitch: 7,
      indexRatio: 0.55,
      protect: 0.4,
      chunkSize: 96,
      inputGain: 1.25,
      outputGain: 1.5,
      denoiseLevel: "strong"
    };

    expect(saveVoiceSettings(filePath, settings)).toEqual(settings);
    expect(loadVoiceSettings(filePath)).toEqual(settings);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({ schemaVersion: 1, settings });
  });

  it("drops unknown and out-of-range values", () => {
    expect(normalizeVoiceSettings({
      pitch: 999,
      indexRatio: 0.45,
      protect: -1,
      chunkSize: 47,
      denoiseLevel: "invalid",
      unexpected: "ignored"
    })).toEqual({ indexRatio: 0.45 });
  });

  it("returns null for a missing or malformed settings file", () => {
    const directory = mkdtempSync(join(tmpdir(), "taffy-voice-settings-"));
    temporaryDirectories.push(directory);
    mkdirSync(directory, { recursive: true });
    expect(loadVoiceSettings(join(directory, "missing.json"))).toBeNull();
  });
});
