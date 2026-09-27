# Taffy Motion Demo

A local-first virtual avatar demo for face, upper-body and hand tracking, PMX rendering, and optional RVC voice conversion. Camera frames and microphone audio are processed locally.

The source repository does not include avatar models, voice-conversion weights, VCClient binaries, generated MediaPipe runtime assets, build outputs, logs, or screenshots. `npm install` downloads the MediaPipe runtime assets required by the app. Model names and third-party model assets have separate terms from this source code. Add only assets you have permission to use, and do not commit them.

## Features

- Face, Pose and Hand Landmarker inference in separate web workers.
- PMX/PMD loading, alias-based bone and morph mapping, and model capability reporting.
- Head, gaze, upper-body, arm and finger tracking, with hand gestures and expression combinations.
- A light, spacious UI with performance, output and diagnostics panels.
- Optional local VCClient integration for RVC voice conversion, device selection and voice parameter control.
- Electron desktop packaging with persistent voice settings.

## Web development

Requirements: Windows 10/11, Node.js 20.19+, and a recent Chrome or Edge browser.

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. Choose a PMX/PMD model folder in the UI. To use the voice conversion panel, start a local VCClient compatible with the documented localhost API. The UI can import a user-provided model after you configure the local model manifest below.

For the optional Windows launcher, set `TAFFY_VCCLIENT_EXE` to your VCClient `main.exe` path, then run `启动塔菲变声.cmd`.

## Desktop build

The desktop build packages local model and VCClient files. Set these environment variables and provide the two ignored local manifests before packaging:

```powershell
$env:TAFFY_AVATAR_MODEL_DIR = "C:\path\to\your\avatar-folder"
$env:TAFFY_VCCLIENT_DIR = "C:\path\to\your\vcclient-runtime"
npm run desktop:pack
```

Copy `desktop/avatar-manifest.example.json` to `desktop/avatar-manifest.json` and `desktop/voice-model-manifest.example.json` to `desktop/voice-model-manifest.json`. Fill in filenames, exact byte counts and SHA-256 values for assets you have permission to use. The local manifest files are git-ignored. See [desktop asset setup](docs/DESKTOP_ASSETS.md).

The avatar folder should contain the PMX file and its referenced textures. The VCClient runtime should contain `main.exe` and the configured RVC slot under `model_dir/<slotIndex>/`. The complete runtime can be several gigabytes. Distribute it only when its license and model terms allow it.

## RVC voice model setup

The voice panel accepts a local RVC model manifest and verifies model file size and SHA-256 before import. Keep `.pth`, `.onnx`, `.index` and `.bin` files outside version control. Read [voice changer setup](docs/VOICE_CHANGER.md) for local server configuration and troubleshooting.

## Development commands

```powershell
npm run build
npm test
npm run test:e2e
```

The end-to-end smoke script supports `TAFFY_MODEL_DIR`, `TAFFY_BASE_URL` and `EDGE_PATH`; provide a local avatar folder at `local-assets/avatar` or set `TAFFY_MODEL_DIR`. Voice and desktop end-to-end scripts also require explicit local executable paths; see their error messages and environment-variable names.

## Data and privacy

Face, pose and hand inference runs in local workers. The voice controller only accepts a loopback address; the raw microphone stream is handled by the local VCClient. No camera frames or audio are uploaded by this application.

## Credits and asset terms

- PMX/PMD parsing and rendering use [babylon-mmd](https://github.com/noname0310/babylon-mmd) and Babylon.js.
- Landmark inference uses [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) and its model assets.
- RVC integration targets [w-okada/voice-changer](https://github.com/w-okada/voice-changer).
- The example avatar mapping profile is tailored to a Taffy avatar rig. The avatar, textures, voice weights, indexes, VCClient runtime and related names are not licensed by this repository's MIT license; obtain them separately and follow their owners' terms.

See [third-party notices](THIRD_PARTY_NOTICES.md) and the [MIT license](LICENSE).
