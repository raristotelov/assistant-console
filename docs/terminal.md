# Terminal layer

## Stack

- **Electron 32** — window + Node main process.
- **node-pty** — spawns a real pty. Native module; needs `electron-rebuild`
  after install (see [setup.md](setup.md)).
- **@xterm/xterm** + **@xterm/addon-fit** — terminal rendering in the renderer.

## Spawn

`startTerminal()` in `src/main.js`:

- Shell: `process.env.SHELL || /bin/zsh` (`powershell.exe` on Windows).
- Size: 100×30 initially, then driven by the fit addon.
- cwd: home directory.
- env: `process.env` plus `ASSISTANT_CONSOLE_SESSION_FILE` — the pointer file the
  SessionStart hook writes to. This is what marks a session as belonging to the app.

`claude` is not auto-launched. You `cd` to a project and run it yourself, so the
session starts in the directory you choose.

## IPC

| Channel | Direction | Purpose |
|---|---|---|
| `term:data` | main → renderer | pty output to draw |
| `term:input` | renderer → main | keystrokes |
| `term:resize` | renderer → main | cols/rows after a fit |
| `term:send-line` | renderer → main | send a whole line (voice or send box) |
| `term:exit` | main → renderer | pty exited |

## Submitting a line

`term:send-line` writes the text, then writes `\r` as a **separate write**
`SUBMIT_KEY_DELAY_MS` (150ms) later.

A carriage return arriving in the same write as the text is taken as part of the
input, not as submit — verified against a real session: a 176-character line
plus `\r` in one write stayed in the input box, while the same text with the
`\r` sent 150ms later submitted normally. Short lines happen to work either way,
which is why this only showed up on longer voice input.

## Window sizing

The renderer runs `fit.fit()` on load and on window resize, then reports
`cols`/`rows` to main, which calls `term.resize()`. Only the pty is resized —
nothing else mirrors the terminal state any more.
