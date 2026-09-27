# Local voice conversion

The voice controller talks to a locally running w-okada VCClient. VCClient owns microphone capture, RVC inference and speaker output; the browser UI sends configuration and control requests to its loopback REST API.

```text
Microphone -> local VCClient / RVC -> headphones, speakers or virtual audio cable
                         ^
                 localhost REST API
```

The controller supports the VCClient v1 and v2 API shapes. It rejects non-loopback endpoints so raw microphone audio remains inside the local audio runtime.

## Start a local service

Install a Windows build of VCClient from its official release channel and review the license and dependency notices that accompany that build. Start its HTTP service bound to `127.0.0.1`; the UI's default endpoint is `http://127.0.0.1:18888`.

For the optional launcher, set `TAFFY_VCCLIENT_EXE` to the full path of `main.exe` and run `启动塔菲变声.cmd`. It starts the service and Vite locally. The launcher does not install voice models or modify VCClient slots.

## Import a user-provided model

The UI can import RVC assets after a local manifest is configured. The manifest must list model and index filenames, byte counts, SHA-256 digests, a display name, a model slot and recommended parameters. The application verifies file size and SHA-256 before sending files to localhost.

Store the manifest and model files in a local folder, then set `TAFFY_VOICE_MODEL_DIR` to that folder before starting Vite. The manifest filename is `manifest.json`; see `desktop/voice-model-manifest.example.json` for the field layout. Keep the model files and filled manifest out of Git.

Importing a model replaces the selected VCClient slot. Choose a slot that does not contain a model you need to keep.

## Parameter starting points

- Pitch shift changes the output pitch in semitones.
- Index ratio blends retrieval features from the model's `.index`; raise it gradually if you want a closer match, and lower it if the output sounds brittle or smeared.
- Protect reduces artifacts around unvoiced consonants.
- Smaller audio chunks can reduce latency but may cause stutter on a busy system.
- The denoise presets use a noise gate and high/low-pass filters before RVC. They are not neural speech separation, so keyboard sounds that overlap speech may remain.
- Headphones prevent speaker output from feeding back into the microphone. For streaming, a virtual audio cable can route VCClient output to OBS.

## Troubleshooting

- Backend offline: start VCClient and verify the HTTP endpoint responds on localhost.
- No model listed: configure the manifest, then import the model into a VCClient slot.
- No compatible audio pair: select input and output devices with the same host API and sample rate.
- Stutter: increase chunk size, close applications holding audio devices, and verify both devices use a supported sample rate.
- Feedback: use headphones or route output through a virtual audio device.

## Licensing

VCClient and RVC are separate projects. This repository contains the API adapter, not their source code or model weights. The desktop packaging workflow can copy in a locally supplied runtime, so anyone producing a package must check the runtime, dependency and model licenses independently.
