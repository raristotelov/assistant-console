# Todo

## Windows support

Blocked: `code-server` publishes no Windows build, and neither does
`openvscode-server`, so the editor pane has no server to run. The only
candidate is Microsoft's own `code serve-web` CLI, which is a different binary
with different flags and may not register the `ideName: "code-server"` lock
that `src/codeServer.js` matches on to find the IDE port.

Everything else is ordinary work: python-build-standalone has msvc builds (with
a different install layout), node-pty runs on ConPTY, whisper.cpp builds with
MSVC, and the idle check in `src/main.js` assumes `$SHELL`.

## Signing

macOS builds are ad-hoc signed, so downloads hit Gatekeeper; Windows would hit
SmartScreen. Real signing needs a paid Apple Developer ID.

## Smaller, still open

- `docs/` still describes the single-session architecture; the sidebar, per-session readers and stats bar are not written up.
- Sidebar lists only sessions opened in the current run — session history deferred.
- Bulgarian replies: would mean routing Cyrillic text to piper `bg_BG-dimitar-medium` while Kokoro handles English.
- Ducking during playback instead of hard barge-in.
- Account-level `/usage` limits and reset times need a credentialed Anthropic API call; nothing on disk has them.
