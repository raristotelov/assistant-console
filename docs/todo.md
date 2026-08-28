# Todo

## Package as a standalone macOS app

Goal: a real `Assistant Console.app` in /Applications, launched from Spotlight or the Dock — no `npm start`.

Tool: `electron-builder` (add `build` config + `dist` script to `package.json`).

Three things that must be solved for it to actually work:

- **`node-pty` native rebuild** — must be compiled against the packaged Electron ABI, not the system Node. `electron-builder` does this via `postinstall: electron-builder install-app-deps`; verify the terminal actually spawns in the built app, not just that the build succeeds.
- **External paths currently read from `.env`** — `WHISPER_BIN`, `KOKORO_PYTHON`, the whisper model, and `src/tts_worker.py`. `dotenv/config` resolves `.env` relative to the working directory, which is not the bundle. Decide per path whether it ships inside the app or stays a user-configured absolute path, and load it from a location that exists at runtime (e.g. `app.getPath("userData")`).
- **Microphone permission** — needs `NSMicrophoneUsageDescription` in the Info.plist (`build.mac.extendInfo`) and at least ad-hoc code signing. Without both, the VAD mic fails silently rather than prompting.

Also expect a Gatekeeper warning on first launch while the app is unsigned by a Developer ID.

## Smaller, still open

- No ESLint/Prettier config or `lint`/`format` scripts for this project yet.
- `docs/` still describes the single-session architecture; the sidebar, per-session readers and stats bar are not written up.
- Sidebar lists only sessions opened in the current run — session history deferred.
- Bulgarian replies: would mean routing Cyrillic text to piper `bg_BG-dimitar-medium` while Kokoro handles English.
- Ducking during playback instead of hard barge-in.
- Account-level `/usage` limits and reset times need a credentialed Anthropic API call; nothing on disk has them.
