# Third-party notices

The source code in this repository is licensed under the MIT License in `LICENSE`. Third-party packages and model/runtime assets keep their own licenses.

## MediaPipe Tasks Vision

- Package: `@mediapipe/tasks-vision` 1.0.1
- Copyright: Google LLC
- License: Apache License 2.0
- Source: <https://github.com/google-ai-edge/mediapipe>
- Purpose: local face, pose and hand landmark inference.

The `public/runtime` directory is generated locally by `npm install`; the task model files are downloaded from Google's MediaPipe model distribution and WebAssembly assets are copied from the npm package. Consult the MediaPipe repository and model distribution terms before redistributing or using those files in another product. These generated assets are excluded from this source repository.

## Babylon.js and babylon-mmd

- `@babylonjs/core` and `@babylonjs/loaders`: Apache License 2.0, BabylonJS contributors. <https://github.com/BabylonJS/Babylon.js>
- `babylon-mmd`: MIT License, noname0310 and contributors. <https://github.com/noname0310/babylon-mmd>

## React, Vite and Lucide

- React and React DOM: MIT License.
- Vite: MIT License.
- Lucide: ISC License.

These and the remaining npm dependencies are listed in `package-lock.json`. Each dependency retains its own license.

## VCClient and RVC

The application implements an adapter for the local API exposed by [w-okada/voice-changer](https://github.com/w-okada/voice-changer) and [RVC-Project WebUI](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI). No upstream source code is vendored in this source repository. A desktop build may include a runtime supplied by the builder; that runtime and its dependencies are not covered by this repository's MIT license.

## Avatar and voice assets

No PMX/PMD avatar, texture pack, RVC weight, retrieval index, or user-provided model manifest is included in the source repository. Avatar rig mappings are project data; avatar and voice assets remain subject to their respective owners' terms. The project license does not grant rights to use or redistribute them.
