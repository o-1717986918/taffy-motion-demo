# Desktop asset setup

The desktop build copies local assets into the packaged application. Keep both manifest files and all avatar, voice and VCClient files outside Git.

1. Set `TAFFY_AVATAR_MODEL_DIR` to a folder containing a PMX/PMD model and its referenced textures.
2. Set `TAFFY_VCCLIENT_DIR` to an installed VCClient runtime folder containing `main.exe` and a configured RVC model slot.
3. Copy `desktop/avatar-manifest.example.json` to `desktop/avatar-manifest.json`, then set the model name, display name, relative file paths and exact byte counts.
4. Copy `desktop/voice-model-manifest.example.json` to `desktop/voice-model-manifest.json`, then set the slot, model and index names, exact byte counts, SHA-256 values and recommended settings.
5. Run `npm run desktop:pack`.

Manifest file paths are relative to the avatar directory. The voice model and index paths are resolved under `model_dir/<slotIndex>/` in the VCClient runtime. The build checks that the referenced files exist. The application checks manifest file sizes when it loads the bundled avatar and checks model hashes before an RVC import.

Only package and redistribute assets when their owners' terms allow it. A successful local build does not grant rights to redistribute the avatar, voice model or VCClient runtime.
