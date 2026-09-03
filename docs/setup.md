# Setup

Verified on macOS (Apple Silicon), Node 22, Python 3.11 and 3.13 side by side.

## 1. App

```bash
npm install
npm start
```

`node-pty` is native. If it fails to build, install Xcode command line tools
(`xcode-select --install`). If it builds but Electron reports an ABI mismatch,
run `./node_modules/.bin/electron-rebuild`.

### Running it while you already use the installed app

`npm start` and the installed app can run side by side. A run from source keeps
its Chromium profile in `session-dev` inside the user data directory, so the two
never write the same cookies, IndexedDB or service worker storage.

They must not share one profile. Chromium allows a single writer, and two
instances on the same profile corrupt the quota and service worker databases —
after which VS Code for the web cannot open IndexedDB, and the editor pane comes
up blank with nothing logged. Recovering means deleting `IndexedDB`,
`Service Worker` and `WebStorage/QuotaManager` from the user data directory.

Everything else is still shared: the code-server binary and extensions, the
whisper model and the provisioned Python, so a run from source costs no extra
downloads.

## 2. Speech-to-text — whisper.cpp

Build whisper.cpp and fetch a model. The app needs the binary and model paths
only; nothing is bundled.

## 3. Text-to-speech — Kokoro

```bash
brew install espeak-ng                      # skip if already present
python3.11 -m venv ~/Documents/tools/kokoro/venv
~/Documents/tools/kokoro/venv/bin/pip install kokoro soundfile
```

- Kokoro requires Python 3.10–3.12; a 3.13 default will not work, hence the venv.
- Installing pulls PyTorch — roughly 1.5–2 GB in the venv.
- The ~330 MB model downloads from Hugging Face on first synthesis into
  `~/.cache/huggingface`. No account or token needed; the first run is slow and
  the app is silent until it finishes.

## 4. `.env`

Gitignored, loaded by `dotenv/config` in `src/main.js`:

```
WHISPER_BIN=<path>/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL=<path>/whisper.cpp/models/ggml-small.bin
KOKORO_PYTHON=<path>/tools/kokoro/venv/bin/python
KOKORO_VOICE=af_heart
```

`KOKORO_VOICE` accepts any Kokoro voice (`am_michael`, `bf_emma`, …). If
`KOKORO_PYTHON` is missing the app falls back to plain `python3`, the worker
dies on import, and you get errors in the terminal instead of speech.

Any leftover `PIPER_*` or `SSL_CERT_FILE` entries are unused — piper is no
longer part of the app.

## 5. SessionStart hook

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

Needs `jq`. It is inert in sessions outside the app. Sessions already running
when the hook is added must be restarted.

## Using it

1. `npm start`.
2. In the terminal, `cd` to a project and run `claude`.
3. Toggle **Reading** on to hear replies; **Start listening** for the mic.

## Gotchas

- **Use headphones.** Speaker audio reaches the mic. Sounds that contain real
  speech — notification packs like peon-ping — get transcribed and sent to
  Claude as if you had said them.
- First launch after install is slow (model download) and silent.
- VAD assets load from a CDN, so the mic needs network on first use.
