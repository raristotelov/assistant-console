# Session status

Every session row in the sidebar carries a status dot and a mic/speaker pair. Expanded,
the row is dot, folder name, icons, close. Collapsed, it is a 42px tile laid out as a
2x2 grid: dot and the folder's first letter on top, mic and speaker beneath.

## The dots

| Dot             | Meaning                                                        | Token              |
| --------------- | -------------------------------------------------------------- | ------------------ |
| Grey            | Idle — Claude is not working and there is nothing unread       | `--status-idle`    |
| Orange, pulsing | Claude is working on that session                              | `--status-working` |
| Green           | Claude has answered and you have not opened that session since | `--status-ready`   |
| Red             | The session's shell process exited                             | `--danger`         |

Precedence, highest first: exited, ready, working, idle.

## Where the status comes from

`TranscriptReader` (`src/transcriptReader.js`) already polls each session's Claude Code
transcript JSONL every 300ms for token stats. Status is derived from the same line stream:

- A `type: "user"` entry (a typed prompt, or a tool result) sets **working**.
- A `type: "assistant"` entry containing a text block sets **idle** and fires `onAnswer`.
- Assistant entries with only `tool_use` blocks change nothing, so the status stays
  **working** for the whole tool loop.
- `isSidechain` entries are ignored, as they are for stats.

Main forwards both signals per session — `session:status` and `session:answer`. The
renderer marks a session **ready** when `onAnswer` arrives for a session that is not
focused, and clears it in `activate()`.

## Icons

Both icons are always present on every row. Each has three states: **off** (slashed glyph,
muted), **idle** (plain glyph, muted) and **active** (plain glyph, `--status-ready` green).

- **Microphone** — an indicator only. Off when listening is off; green on the focused
  session while listening is on; idle on the others. Listening is a single global capture
  and `renderer.js` resolves `activeId` at speech-end, so only one row is ever green.
- **Speaker** — a button. Clicking it turns spoken replies on or off for that session,
  without switching to it, through the same `toggleReading` the toolbar uses. Off when
  reading is disabled, idle when enabled, green while that session is actually talking.
  Replies carry their session id from main (`replySessions`) on every audio chunk.

The click is stopped from propagating so it does not also activate the row.

## Limits

- Status lags reality by up to one poll (300ms).
- It reflects the transcript, not the terminal. Anything you run in the shell that is not
  Claude Code leaves the session idle.
- **Ready** is per-session unread state held in the renderer; it does not survive a reload.
- The Figma `Session Tile` has variants for idle, working and ready only. **Exited** exists
  in the code but has no drawn state, so the red dot is unspecified in the design.
