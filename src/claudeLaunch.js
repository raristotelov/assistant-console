// Claude Code reads CLAUDE_CODE_SSE_PORT at launch, so a session with an editor
// has to wait for that port before the main terminal runs `claude`. The wait is
// capped: after it, `claude` comes up unconnected rather than not at all.

const LAUNCH_COMMAND = "claude\r";
const IDE_PORT_WAIT_MS = 10000;

function shouldLaunchClaude({ isMainTerminal, editorPending, idePort, waitedOut }) {
  if (!isMainTerminal) return false;
  if (editorPending && !idePort && !waitedOut) return false;
  return true;
}

module.exports = { shouldLaunchClaude, LAUNCH_COMMAND, IDE_PORT_WAIT_MS };
