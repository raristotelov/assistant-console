# voice-claude

Talk to Claude Code sessions hands-free from a browser — laptop or phone.
The **browser** captures mic + runs VAD; the **laptop server** does STT, runs
Claude Code (Agent SDK), and does TTS. The phone is just a thin client.

```
browser (mic + Silero VAD) --wav--> server
server: whisper.cpp -> Claude Code session -> Piper --audio--> browser
```

## AI providers (Claude Code, ChatGPT, local models)

The app is provider-agnostic — the voice loop talks to a `Provider` interface,
not any specific AI. Pick the active session's provider from the header
dropdown, or set the default with `VOICE_PROVIDER`. Two kinds:

- **agentic** (⚙) — can act on your machine: files, commands, MCP. Only
  Claude Code so far. "Edit my repo" actually works.
- **chat** — conversation only. ChatGPT, or any local/cloud model that speaks
  the OpenAI chat API. Great for talking; can't touch your files.

Configured in `server/config.js`. Built in:

| id | kind | needs |
|----|------|-------|
| `claude-code` | agentic | Claude Code installed + logged in |
| `openai` | chat | `OPENAI_API_KEY` (opt. `OPENAI_MODEL`) |
| `ollama` | chat | `ollama serve` + a pulled model (local, free) |
| `lmstudio` | chat | LM Studio local server running |

```bash
# examples
export VOICE_PROVIDER=ollama          # default new sessions to local Llama
export OPENAI_API_KEY=sk-...          # enable ChatGPT
export OLLAMA_MODEL=llama3.1          # which local model
```

Because Ollama, LM Studio, OpenRouter, Groq, and most others all speak the
OpenAI chat format, one adapter (`OpenAICompatProvider`) covers them — adding a
new one is a few lines in `config.js` (base URL + key + model). Each session can
run a different provider, so you can have Claude Code for coding and a private
local model for chat side by side.

## Prerequisites (on the laptop/server)

1. **Node 20+** and **Claude Code** installed and logged in (the Agent SDK uses
   your existing Claude auth).
2. **whisper.cpp** (local STT) — build it and download a model:
   - Binary e.g. `whisper-cli`, model e.g. `ggml-small.bin`.
3. **Piper** (local TTS) — install the binary and download a voice `.onnx`.

Point the server at them via env vars (defaults in `server/speech.js`):

```bash
export WHISPER_BIN=/path/to/whisper-cli
export WHISPER_MODEL=/path/to/ggml-small.bin
export PIPER_BIN=/path/to/piper
export PIPER_VOICE=/path/to/en_US-amy-medium.onnx
```

## Run

```bash
npm install
npm start
# http://localhost:4141
```

Open it, click **Start listening**, and just talk — VAD detects when you start
and stop. Or type in the box.

## From your phone

Put laptop + phone on a Tailscale network, then open
`http://<laptop-tailscale-ip>:4141` in the phone browser. Same voice loop; the
laptop does all the work. (Add it to your home screen for an app-like feel;
a PWA manifest can make that cleaner later.)

Note: mobile browsers restrict background mic access, so hands-free works while
the page is foregrounded. True "screen off, always listening" would need a
native app later.

## Structure

```
server/
  index.js      Express static + WebSocket + the voice<->AI loop
  config.js     Provider config — add/switch AI backends here
  sessions.js   Session manager (provider-agnostic, multi-session ready)
  speech.js     whisper.cpp (STT) + Piper (TTS) subprocess wrappers
  providers/
    base.js         Provider interface + registry
    claudeCode.js   Claude Code (agentic) via Agent SDK
    openaiCompat.js OpenAI-compatible (ChatGPT, Ollama, LM Studio, …)
public/
  index.html    dashboard shell (sidebar + provider picker + conversation + mic)
  app.js        mic + Silero VAD + WebSocket + transcript + audio playback
  style.css
```

## Growth areas (already stubbed)

- **Multi-session**: sidebar lists sessions; "switch"/"new" wired in the socket.
  Voice-switching ("switch to X") = map a phrase to the switch message.
- **Tool-call feed**: surface what Claude does (edits, commands) as events.
- **Approvals**: render permission requests as cards you can approve by voice.
- **PWA**: add manifest + service worker for install + offline shell.
- **Swap engines**: Piper → Kokoro for nicer voice; whisper → faster-whisper.

## Notes / caveats

- Agent SDK message shapes vary by version — `server/sessions.js` extracts text
  defensively; adjust `extractText`/`query` options to the installed SDK.
- Headless SDK usage draws from a separate weekly pool on subscription plans;
  heavy always-on voice use may hit it sooner.
- Everything runs locally — no cloud STT/TTS, audio only leaves the browser as
  WAV to your own laptop.
