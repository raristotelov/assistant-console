const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldLaunchClaude, LAUNCH_COMMAND, IDE_PORT_WAIT_MS } = require("../src/claudeLaunch");

test("with no editor the main terminal launches straight away", () => {
  assert.equal(
    shouldLaunchClaude({ isMainTerminal: true, editorPending: false, idePort: null }),
    true,
  );
});

test("an editor that has not reported its port holds the launch back", () => {
  assert.equal(
    shouldLaunchClaude({ isMainTerminal: true, editorPending: true, idePort: null }),
    false,
  );
  assert.equal(
    shouldLaunchClaude({ isMainTerminal: true, editorPending: true, idePort: 63123 }),
    true,
  );
});

test("a terminal that is not the main one never auto-launches", () => {
  assert.equal(
    shouldLaunchClaude({ isMainTerminal: false, editorPending: false, idePort: null }),
    false,
  );
  assert.equal(
    shouldLaunchClaude({ isMainTerminal: false, editorPending: true, idePort: 63123 }),
    false,
  );
});

test("once the wait is out it launches without the port", () => {
  assert.equal(
    shouldLaunchClaude({
      isMainTerminal: true,
      editorPending: true,
      idePort: null,
      waitedOut: true,
    }),
    true,
  );
  assert.equal(
    shouldLaunchClaude({
      isMainTerminal: false,
      editorPending: true,
      idePort: null,
      waitedOut: true,
    }),
    false,
  );
});

test("the launch command submits on its own, after a bounded wait", () => {
  assert.equal(LAUNCH_COMMAND, "claude\r");
  assert.equal(IDE_PORT_WAIT_MS, 10000);
});
