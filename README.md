# assistant-console

A desktop app with a live terminal running your real `claude` session — type in
it like a normal terminal, or talk to it and hear the replies. Built on Electron
so it can embed a real terminal (node-pty + xterm.js), the way VS Code's does.

It is your actual Claude Code: full `~/.claude` config, agents, MCP, CLAUDE.md.
Not the Agent SDK, not `claude -p`, and voice drives the same single session.

## What works

- Real terminal in a window; you `cd` and start `claude` yourself.
- Talk to it: Silero VAD → whisper.cpp → your words typed into the session.
- Hear it: replies are read from the session transcript, cleaned of markdown,
  and spoken by Kokoro sentence-by-sentence as they are generated.
- Interrupt by speaking (on confirmed words, not on noise), or with Stop.

## Download

Grab a build from [Releases](https://github.com/raristotelov/assistant-console/releases)
— macOS and Linux, Intel and ARM. Windows is not supported yet.

- **macOS** (`.dmg`) — drag to Applications. The app is ad-hoc signed, not
  notarized, so first launch is blocked: either open System Settings → Privacy
  & Security → **Open Anyway**, or run
  `xattr -dr com.apple.quarantine "/Applications/Assistant Console.app"`.
- **Linux** (`.AppImage`) — `chmod +x` it and run it. Nothing to install.
- **Linux** (`.deb`, Debian/Ubuntu) — `sudo apt install ./assistant-console_*.deb`.

## Run

```bash
npm install
npm start
npm test
```

Speech needs whisper.cpp, a Kokoro venv, a `.env`, and a `SessionStart` hook —
see [docs/setup.md](docs/setup.md).

## Release

Pushing a `v*` tag builds all four targets and publishes a GitHub Release:

```bash
npm version patch
git push --follow-tags
```

`.github/workflows/release.yml` runs on macOS arm64/x64 and Linux x64/arm64,
building `whisper-cli` natively on each before packaging.

## Docs

Start with [docs/project.md](docs/project.md); architecture, each layer, setup
and testing are split out from there.
