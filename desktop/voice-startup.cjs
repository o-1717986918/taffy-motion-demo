function chooseAudioDevice(devices) {
  return devices.find((device) => device.host_api === "Windows WASAPI" && Number(device.default_samplerate) === 48000)
    ?? devices.find((device) => device.host_api === "Windows WASAPI")
    ?? devices[0];
}

function currentAudioDevice(devices, configuredIndex) {
  return devices.find((device) => Number(device.index) === Number(configuredIndex));
}

function currentGpuDevice(devices, configuredIndex) {
  return devices.find((device) => Number(device.device_id_int) === Number(configuredIndex));
}

function buildVoiceStartupState(configuration, inputs, outputs, gpus) {
  const input = currentAudioDevice(inputs, configuration.audio_input_device_index)
    ?? chooseAudioDevice(inputs);
  const output = currentAudioDevice(outputs, configuration.audio_output_device_index)
    ?? chooseAudioDevice(outputs);
  if (!input || !output) throw new Error("没有发现可用的麦克风或扬声器。");
  const gpu = currentGpuDevice(gpus, configuration.gpu_device_id_int)
    ?? gpus.find((device) => Number(device.device_id_int) >= 0 && /NVIDIA/i.test(String(device.name)))
    ?? gpus.find((device) => Number(device.device_id_int) >= 0);

  return {
    input,
    output,
    gpu,
    configuration: {
      ...configuration,
      current_slot_index: 168,
      voice_changer_input_mode: "server",
      audio_input_device_index: input.index,
      audio_output_device_index: output.index,
      audio_input_device_sample_rate: input.default_samplerate,
      audio_output_device_sample_rate: output.default_samplerate,
      gpu_device_id_int: gpu?.device_id_int ?? -1,
      input_sample_rate: input.default_samplerate,
      output_sample_rate: output.default_samplerate
    }
  };
}

module.exports = { buildVoiceStartupState };
