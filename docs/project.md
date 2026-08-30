# assistant-console

Electron desktop app with an embedded live terminal running your real
interactive Claude Code session. Type in it, or talk to it and hear replies.

## Non-goals

- **No Agent SDK** — it runs a bare agent that ignores `~/.claude` config.
- **No `claude -p` / headless** — the full interactive TUI is the point.
- **No second session for voice** — voice reads and drives the one live session.

## Docs

| File                               | Covers                                                  |
| ---------------------------------- | ------------------------------------------------------- |
| [architecture.md](architecture.md) | Layers, data flow, why replies come from the transcript |
| [terminal.md](terminal.md)         | Electron, node-pty, xterm.js, input submission          |
| [voice-input.md](voice-input.md)   | VAD → whisper → typed into the terminal                 |
| [voice-output.md](voice-output.md) | Transcript → speakable text → Kokoro → playback         |
| [setup.md](setup.md)               | Install, `.env`, the SessionStart hook, gotchas         |
| [testing.md](testing.md)           | Test suites, coverage, what is out of scope             |

## Layout

```
src/
  main.js             Electron main: window, pty, IPC, reply → speech
  preload.js          contextBridge (term + voice)
  index.html          UI: xterm + mic / reading / stop / send controls
  renderer.js         xterm wiring, VAD mic loop, audio playback queue
  speech.js           whisper.cpp (STT) + TtsEngine (resident TTS worker)
  speakable.js        markdown → speakable text
  transcriptReader.js tails the session transcript for assistant replies
  tts_worker.py       resident Kokoro process, streams WAV per sentence
test/                 node:test suites + python unittest
```
