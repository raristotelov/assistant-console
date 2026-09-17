# Setup

Verified on macOS (Apple Silicon). Linux builds are produced but untested.

## Install

Download from [Releases](https://github.com/raristotelov/assistant-console/releases):
`.dmg` (macOS), `.AppImage` or `.deb` (Linux), Intel and ARM for both.

The macOS build is ad-hoc signed, not notarized, so first launch is blocked.
Either System Settings → Privacy & Security → **Open Anyway**, or:

```bash
xattr -dr com.apple.quarantine "/Applications/Assistant Console.app"
```

### First launch

The app provisions itself into its user data directory — no manual setup:

- whisper model `ggml-small.bin`
- a standalone Python 3.11 plus `kokoro` (pulls PyTorch, a few minutes)
- `code-server` for the editor pane, on first use

Needs network, and voice stays silent until it finishes. The Kokoro voice model
(~330 MB) downloads from Hugging Face into `~/.cache/huggingface` on first
synthesis. `espeak-ng` is not required — `kokoro` ships its own via
`espeakng_loader`.

### What the app does not install

- **`claude`** on `PATH` — the terminal runs it.
- **The SessionStart hook** below, and `jq`. Without it the app works but
  nothing is read aloud.
- **VS Code**, if you want your settings, keybindings and extensions seeded
  into the editor pane; without it the pane still opens, just bare.

## SessionStart hook

Required for spoken replies. Add to the `SessionStart` array in
`~/.claude/settings.json` (and keep it in the config repo so a sync does not
wipe it):

```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "# assistant-console voice app: when its terminal sets ASSISTANT_CONSOLE_SESSION_FILE, write this session's transcript path there so the app can read Claude's replies aloud\nif [ -n \"$ASSISTANT_CONSOLE_SESSION_FILE\" ]; then jq -r .transcript_path > \"$ASSISTANT_CONSOLE_SESSION_FILE\"; fi",
      "timeout": 5
    }
  ]
}
```

It is inert in sessions outside the app. Sessions already running when the hook
is added must be restarted.

## Run from source

```bash
npm install
npm start
npm test
```

`node-pty` is native. If it fails to build, install Xcode command line tools
(`xcode-select --install`). If it builds but Electron reports an ABI mismatch,
run `./node_modules/.bin/electron-rebuild`.

`whisper-cli` ships inside the packaged app only. From source, point
`WHISPER_BIN` at a build of it (`bash scripts/build-whisper.sh` produces one in
`tools/whisper/`) or put it on `PATH`. Everything else provisions the same way
it does in the installed app.

### Alongside the installed app

`npm start` and the installed app run side by side. A run from source keeps its
Chromium profile in `session-dev` inside the user data directory, so the two
never write the same cookies, IndexedDB or service worker storage.

They must not share one profile. Chromium allows a single writer, and two
instances on the same profile corrupt the quota and service worker databases —
after which VS Code for the web cannot open IndexedDB, and the editor pane comes
up blank with nothing logged. Recovering means deleting `IndexedDB`,
`Service Worker` and `WebStorage/QuotaManager` from the user data directory.

The code-server binary and extensions, the whisper model and the provisioned
Python are shared, so a run from source costs no extra downloads.

## Optional `.env`

Gitignored, loaded by `dotenv/config` in `src/main.js`. Every entry is an
override — the app provisions working defaults for all but `WHISPER_BIN` when
run from source.

```
WHISPER_BIN=<path>/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL=<path>/ggml-small.bin
KOKORO_PYTHON=<path>/venv/bin/python
KOKORO_VOICE=af_heart
```

`KOKORO_VOICE` accepts any Kokoro voice (`am_michael`, `bf_emma`, …).

## Gotchas

- **Use headphones.** Speaker audio reaches the mic. Sounds that contain real
  speech — notification packs like peon-ping — get transcribed and sent to
  Claude as if you had said them.
- First launch is slow and silent while provisioning runs.
- VAD assets load from a CDN, so the mic needs network on first use.
