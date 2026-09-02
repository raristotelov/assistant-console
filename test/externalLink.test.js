const test = require("node:test");
const assert = require("node:assert/strict");
const { isExternal, handleWindowOpen } = require("../src/externalLink");

const opened = () => {
  const urls = [];
  return { urls, open: (url) => urls.push(url) };
};

test("http and https are external, other schemes are not", () => {
  assert.equal(isExternal("http://github.com/login"), true);
  assert.equal(isExternal("https://github.com/login"), true);
  assert.equal(isExternal("vscode://vscode.github-authentication/did-authenticate"), false);
  assert.equal(isExternal("file:///etc/passwd"), false);
  assert.equal(isExternal("javascript:alert(1)"), false);
  assert.equal(isExternal("not a url"), false);
  assert.equal(isExternal(""), false);
});

test("an http url goes to the external opener", () => {
  const sink = opened();
  handleWindowOpen("https://github.com/login/oauth/authorize", sink.open);
  assert.deepEqual(sink.urls, ["https://github.com/login/oauth/authorize"]);
});

test("other schemes are not opened", () => {
  const sink = opened();
  handleWindowOpen("file:///etc/passwd", sink.open);
  handleWindowOpen("vscode://vscode.github-authentication/did-authenticate", sink.open);
  handleWindowOpen("nonsense", sink.open);
  assert.deepEqual(sink.urls, []);
});

test("the popup is always denied", () => {
  const sink = opened();
  assert.deepEqual(handleWindowOpen("https://github.com/login", sink.open), { action: "deny" });
  assert.deepEqual(handleWindowOpen("file:///etc/passwd", sink.open), { action: "deny" });
});
