const test = require("node:test");
const assert = require("node:assert/strict");
const { serverEnv } = require("../src/codeServer");

test("the launching editor's own variables are kept out of the server", () => {
  const clean = serverEnv({
    PATH: "/usr/bin",
    HOME: "/Users/me",
    VSCODE_IPC_HOOK_CLI: "/tmp/vscode-ipc.sock",
    VSCODE_GIT_ASKPASS_MAIN: "/x/askpass.js",
    VSCODE_INJECTION: "1",
  });
  assert.deepEqual(clean, { PATH: "/usr/bin", HOME: "/Users/me" });
});

test("everything else is passed through untouched", () => {
  const env = { PATH: "/usr/bin", SHELL: "/bin/zsh", TERM_PROGRAM: "vscode" };
  assert.deepEqual(serverEnv(env), env);
});
