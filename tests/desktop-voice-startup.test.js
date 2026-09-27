import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildVoiceStartupState } = require("../desktop/voice-startup.cjs");

describe("desktop voice startup", () => {
  it("preserves user voice tuning and keeps valid selected devices", () => {
    const original = {
      current_slot_index: 168,
      voice_changer_input_mode: "server",
      audio_input_device_index: 91,
      audio_output_device_index: 72,
      gpu_device_id_int: 4,
      audio_input_device_gain: 1.25,
      audio_output_device_gain: 1.5,
      noise_gate: -45,
      enable_high_pass_filter: true,
      high_pass_filter_cutoff: 100,
      enable_low_pass_filter: true,
      low_pass_filter_cutoff: 10000,
      extra_frame_sec: 0.08,
      crossfade_sec: 0.05,
      sola_search_frame_sec: 0.012
    };
    const inputs = [
      { index: 1, name: "Default USB Audio Input", host_api: "Windows WASAPI", default_samplerate: 48000 },
      { index: 91, name: "User microphone", host_api: "Windows WASAPI", default_samplerate: 48000 }
    ];
    const outputs = [
      { index: 2, name: "Default USB Audio Output", host_api: "Windows WASAPI", default_samplerate: 48000 },
      { index: 72, name: "User output", host_api: "Windows WASAPI", default_samplerate: 48000 }
    ];
    const gpus = [
      { device_id_int: 0, name: "NVIDIA default" },
      { device_id_int: 4, name: "User GPU" }
    ];

    const result = buildVoiceStartupState(original, inputs, outputs, gpus);

    expect(result.input.index).toBe(91);
    expect(result.output.index).toBe(72);
    expect(result.gpu.device_id_int).toBe(4);
    for (const key of [
      "audio_input_device_gain", "audio_output_device_gain", "noise_gate",
      "enable_high_pass_filter", "high_pass_filter_cutoff", "enable_low_pass_filter",
      "low_pass_filter_cutoff", "extra_frame_sec", "crossfade_sec", "sola_search_frame_sec"
    ]) expect(result.configuration[key]).toBe(original[key]);
  });

  it("falls back only when a saved audio device is unavailable", () => {
    const result = buildVoiceStartupState(
      { audio_input_device_index: 999, audio_output_device_index: 999, gpu_device_id_int: 999, noise_gate: -57 },
      [{ index: 3, name: "Default USB Audio input", host_api: "Windows WASAPI", default_samplerate: 48000 }],
      [{ index: 5, name: "Default USB Audio output", host_api: "Windows WASAPI", default_samplerate: 48000 }],
      [{ device_id_int: 0, name: "NVIDIA GPU" }]
    );

    expect(result.configuration.audio_input_device_index).toBe(3);
    expect(result.configuration.audio_output_device_index).toBe(5);
    expect(result.configuration.gpu_device_id_int).toBe(0);
    expect(result.configuration.noise_gate).toBe(-57);
  });
});
