# VS Code integration

Each session opens one project folder and can hold two panes: VS Code on top,
the Claude Code terminal below, split by a draggable divider.

## What runs

| Piece       | Where                   | Notes                                                |
| ----------- | ----------------------- | ---------------------------------------------------- |
| code-server | own process per session | VS Code workbench served over HTTP                   |
| webview     | renderer                | points at `http://127.0.0.1:<port>/?folder=<folder>` |
| pty         | main                    | the same folder as cwd, unchanged from before        |

VS Code's own integrated terminal is for project commands. Claude Code stays in
the xterm pane, because voice input needs our pty to inject the transcribed line.

## Why code-server

- **openvscode-server** publishes Linux builds only — no darwin asset in any
  recent release, so it cannot run on macOS without building from source.
- **Monaco** is the editor component alone: no file tree, terminal, extensions
  or debugger.
- **Desktop VS Code** is its own Electron app and cannot be rendered inside
  another Electron window.

## The binary

Downloaded on first use, not bundled — the tarball is large and per-platform,
and nested binaries inside a signed `.app` are the hardest part of macOS
packaging.

- Version pinned in `codeServer.js` (`VERSION`).
- Extracted with system `tar` into `<userData>/code-server/`.
- Started with `--bind-addr 127.0.0.1:<free port> --auth none`, plus explicit
  `--user-data-dir` and `--extensions-dir`.
- Readiness is a TCP connect poll, not log parsing.

## Settings and extensions

- **Extensions**: one shared dir for every session. Seeded once from
  `~/.vscode/extensions`, so installed extensions carry over.
- **Settings**: per project (`user-data/<hash of folder>`), because two
  code-server processes cannot share one user-data dir. Seeded from a template,
  which is itself seeded once from the desktop VS Code `User` directory.
- Seeding checks for the _files_, not the directory — code-server creates those
  directories itself on first launch.

Extensions come from Open VSX. Ones absent there still work (they were copied)
but cannot be updated from inside code-server.

## Connecting Claude Code to the editor

The Claude Code extension runs inside code-server and writes
`~/.claude/ide/<port>.lock` with `ideName: "code-server"` and the workspace
folder. The CLI reads that directory, but when it believes it is running in an
IDE's integrated terminal it only offers IDEs that are its own ancestor
processes — which a shell spawned by this app never is.

Two consequences:

- The pty env is sanitised. Launching the app from a VS Code terminal otherwise
  leaks `TERM_PROGRAM=vscode` and that window's `CLAUDE_CODE_SSE_PORT` into
  every session, pinning Claude Code to the wrong editor.
- `CLAUDE_CODE_SSE_PORT` is set to the session's own port, which is the one
  documented path that skips the ancestry check. It is passed at spawn when the
  editor started first, otherwise exported into the shell — only while the
  foreground process is still the shell, so it cannot be typed into a running
  Claude Code.

Claude Code reads the variable at launch, so it must start after VS Code is up.
