# Architecture

## Processes

| Process           | Runs           | Holds                                      |
| ----------------- | -------------- | ------------------------------------------ |
| Electron main     | Node           | pty, transcript reader, TTS engine, IPC    |
| Renderer          | Chromium       | xterm.js, VAD mic loop, Web Audio playback |
| Shell (pty child) | zsh → `claude` | the real Claude Code session               |
| TTS worker        | Python 3.11    | Kokoro model, resident across replies      |

Renderer never touches Node APIs directly — `preload.js` exposes `window.term`
and `window.voice` over `contextBridge`.

## Flow

```
you type ──────────────► xterm ──► term:input ──► pty ──► claude
you speak ─► VAD ─► whisper ─► term:send-line ──► pty ──► claude
                                                          │
claude writes its reply to the session transcript ◄───────┘
                        │
        SessionStart hook told the app which file that is
                        │
   transcriptReader (poll) ──► toSpeakable ──► tts_worker (Kokoro)
                                                    │
                        voice:audio-chunk ──► playback queue ──► speakers
```

## Why replies come from the transcript, not the screen

The first implementation fed pty bytes into a headless xterm and scraped the
rendered screen for `⏺`-marked reply lines. It failed for two reasons:

- The headless terminal was never resized with the real one, so cursor
  positioning landed on wrong coordinates and the buffer interleaved reply text
  with spinner and status output mid-word.
- Even rendered correctly, it is pattern matching against a TUI — any change to
  glyphs, wrapping or status lines breaks it silently.

Claude Code already appends every message to
`~/.claude/projects/<project-slug>/<session-id>.jsonl` as it goes. Reading that
gives the exact reply text with no parsing. The session id is a random UUID, so
the app cannot guess the filename — see [voice-output.md](voice-output.md) for
how the SessionStart hook supplies it.

## Layer boundaries

- `speakable.js` and the `speechOnly` filter in `speech.js` are pure functions —
  all text policy lives there and is unit tested.
- `transcriptReader.js` only decides _what text to speak_; it knows nothing
  about audio.
- `speech.js` owns process lifecycles (whisper per call, TTS worker resident).
- `renderer.js` owns playback order and barge-in; main owns synthesis and cancel.
