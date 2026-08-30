# Voice output (Claude → you)

Reading is **off** by default; the Reading toggle enables it, independently of
the mic.

## 1. Finding the session transcript

Every Claude session writes to
`~/.claude/projects/<project-slug>/<session-id>.jsonl`. The session id is a
random UUID, and you may run several sessions in one project, so the file cannot
be guessed.

A `SessionStart` hook in `~/.claude/settings.json` resolves it:

```sh
if [ -n "$ASSISTANT_CONSOLE_SESSION_FILE" ]; then jq -r .transcript_path > "$ASSISTANT_CONSOLE_SESSION_FILE"; fi
```

- Claude Code passes `transcript_path` to every hook on stdin.
- `ASSISTANT_CONSOLE_SESSION_FILE` is set only by the app's pty, so sessions
  started in a normal terminal do nothing.
- The pointer file is `<tmpdir>/assistant-console-session-<pid>`, deleted on quit.
- `SessionStart` also fires on `resume`, `clear`, `compact` and `fork`, so the
  pointer follows `/clear` and resumes.

## 2. Reading new replies — `transcriptReader.js`

- Polls the pointer and transcript every 300ms.
- On enable, jumps to the current end of file so existing history is never read
  aloud. Same when the pointer changes to a new session.
- Tracks a byte offset and carries partial trailing lines between polls, so a
  half-written JSON line is never parsed.
- Emits only entries where `type === "assistant"` and `isSidechain` is falsy,
  joining the `text` content blocks. Tool calls, user entries and subagent
  messages are skipped.

## 3. Making it speakable — `speakable.js`

`toSpeakable()` converts markdown to what should actually be said:

- **Skipped entirely:** fenced code blocks (including unclosed) and tables. If
  anything was skipped, one sentence is appended: _"There's something in the
  terminal you need to see."_
- **Stripped:** emphasis, inline backticks, heading/list/quote markers, emoji
  (including modifiers and ZWJ sequences), link URLs (link text is kept).
- **Expanded:** all-caps tokens of 2–5 letters become spaced letters, so `PR`
  reads as "P R" rather than being mangled. Cost: `JSON` becomes "J S O N".

## 4. Synthesis — `tts_worker.py` + `TtsEngine`

**Kokoro 82M** (`hexgrad/Kokoro-82M`, `lang_code="a"`), voice from `KOKORO_VOICE`
(default `af_heart`), in a resident Python 3.11 process. It loads the model once
and stays alive for the life of the app.

Protocol over stdin/stdout — one JSON header line, then raw bytes:

| Direction | Message                                             |
| --------- | --------------------------------------------------- |
| in        | `{"id": n, "text": "..."}` — speak this reply       |
| in        | `{"cancel": n}` — stop; ids ≤ n are dropped         |
| out       | `{"ready": true}` — model loaded                    |
| out       | `{"id", "seq", "len", "last"}` + `len` bytes of WAV |
| out       | `{"id", "error"}`                                   |

The worker splits the reply into sentences and emits each as a 24 kHz mono WAV
as soon as it is ready, checking for cancels between sentences. `TtsEngine`
reassembles frames across arbitrary chunk boundaries (audio payloads contain
newline bytes, so framing is length-prefixed, not line-based) and restarts the
worker if it dies.

**Why resident + streamed:** the previous design spawned a fresh process per
reply and synthesized the whole thing before playing — measured 1.17s for one
sentence and 6.28s for a paragraph. Now the model is already loaded and the
first sentence plays while the rest is still being generated: measured
0.23–0.83s per sentence warm, so latency no longer scales with reply length.

## 5. Playback — `renderer.js`

- Chunks go into a queue and play strictly in order; a `playing` flag keeps
  `onended` from starting two sources at once.
- `stopSpeaking()` cancels synthesis in the worker, clears the queue and stops
  the current source. Used by the Stop button and by confirmed-speech barge-in.
- `lastCancelledReplyId` drops late-arriving chunks of a cancelled reply.

## Known limits

- **English only.** Kokoro has no Bulgarian voice. piper ships exactly one
  (`bg_BG-dimitar-medium`), so bilingual output would mean routing Cyrillic
  replies to piper and keeping Kokoro for English. Not implemented.
- Torch/Hugging Face print harmless warnings on worker startup; they surface in
  the terminal as `[voice error: …]` because all worker stderr is forwarded.
