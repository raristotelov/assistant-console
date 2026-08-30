# Testing

```bash
npm test        # both suites
npm run test:js # node --test
npm run test:py # python3 test/tts_worker_test.py
```

No test dependencies: Node's built-in runner and Python's `unittest`. Nothing
needs the app, a mic, or the speech models — the full suite runs in well under a
second.

## Suites

| File                            | Tests | Covers                                                                                                             |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `test/speakable.test.js`        | 12    | markdown stripping, code fences and tables → notice, emoji, acronym expansion                                      |
| `test/speechOnly.test.js`       | 7     | whisper non-speech annotations, non-latin speech kept                                                              |
| `test/ttsEngine.test.js`        | 7     | worker framing: split writes, several frames per write, newline bytes inside payloads, error headers               |
| `test/transcriptReader.test.js` | 9     | history skipping, entry-type filtering, `/clear` session switch, half-written lines, malformed JSON, missing files |
| `test/tts_worker_test.py`       | 10    | sentence splitting, inbox routing and cancel threshold                                                             |

Tests drive `TtsEngine.consume()` and `TranscriptReader.poll()` directly rather
than spawning processes or waiting on timers, so they are deterministic.

## Deliberately not covered

- **`main.js`** — Electron app lifecycle and IPC wiring.
- **`renderer.js` playback queue** — needs DOM and Web Audio; would have to be
  extracted into its own module first.
- **Real whisper/Kokoro output** — model behaviour, not our logic.
- **TUI behaviour** — e.g. the carriage-return submit rule in
  [terminal.md](terminal.md). Only driving a real session finds that class of
  bug; it was found with a throwaway pty probe, not a unit test.

## Note

`speechOnly` is exported from `src/speech.js` solely so it can be tested.
