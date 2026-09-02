const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatTokens,
  sessionName,
  sessionMonogram,
  sessionStatus,
  micState,
  speakerState,
  canChangeFolder,
  moveSession,
} = require("../src/sessionView");

const session = (extra = {}) => ({
  id: 1,
  folder: "/Users/me/projects/assistant-console",
  exited: false,
  unread: false,
  status: "idle",
  reading: false,
  speaking: false,
  term: null,
  editorUrl: null,
  ...extra,
});

test("names a session after its folder", () => {
  assert.equal(sessionName(session()), "assistant-console");
  assert.equal(sessionName(session({ folder: "/Users/me/projects/demo/" })), "demo");
  assert.equal(sessionName(session({ folder: "/", id: 7 })), "Session 7");
});

test("monogram is the folder's first alphanumeric, lowercased", () => {
  assert.equal(sessionMonogram(session()), "a");
  assert.equal(sessionMonogram(session({ folder: "/x/LOVB-payload" })), "l");
  assert.equal(sessionMonogram(session({ folder: "/x/.dotfiles" })), "d");
  assert.equal(sessionMonogram(session({ folder: "/x/2fa" })), "2");
});

test("monogram falls back when the name has no alphanumerics", () => {
  assert.equal(sessionMonogram(session({ folder: "/x/---" })), "•");
});

test("status precedence is exited, ready, working, idle", () => {
  assert.equal(sessionStatus(session()), "idle");
  assert.equal(sessionStatus(session({ status: "working" })), "working");
  assert.equal(sessionStatus(session({ unread: true, status: "working" })), "ready");
  assert.equal(sessionStatus(session({ exited: true, unread: true })), "exited");
});

test("mic is off unless listening, and green only on the focused session", () => {
  assert.equal(micState(session(), false, 1), "off");
  assert.equal(micState(session(), true, 1), "active");
  assert.equal(micState(session(), true, 2), "idle");
});

test("speaker is green while talking, idle when reading is on, otherwise off", () => {
  assert.equal(speakerState(session()), "off");
  assert.equal(speakerState(session({ reading: true })), "idle");
  assert.equal(speakerState(session({ reading: true, speaking: true })), "active");
  assert.equal(speakerState(session({ speaking: true })), "active");
});

test("the folder can only change while both panes are closed", () => {
  assert.equal(canChangeFolder(session()), true);
  assert.equal(canChangeFolder(session({ term: {} })), false);
  assert.equal(canChangeFolder(session({ editorUrl: "http://127.0.0.1:8080/" })), false);
  assert.equal(canChangeFolder(session({ term: {}, editorUrl: "http://127.0.0.1:8080/" })), false);
  assert.equal(canChangeFolder(undefined), false);
});

test("name and monogram follow a changed folder", () => {
  const changed = session({ folder: "/Users/me/projects/lovb-payload" });
  assert.equal(sessionName(changed), "lovb-payload");
  assert.equal(sessionMonogram(changed), "l");
});

test("moves a session down the list", () => {
  assert.deepEqual(moveSession([1, 2, 3, 4], 0, 3), [2, 3, 1, 4]);
  assert.deepEqual(moveSession([1, 2, 3, 4], 1, 4), [1, 3, 4, 2]);
});

test("moves a session up the list", () => {
  assert.deepEqual(moveSession([1, 2, 3, 4], 3, 1), [1, 4, 2, 3]);
  assert.deepEqual(moveSession([1, 2, 3, 4], 2, 0), [3, 1, 2, 4]);
});

test("moves a session to either end", () => {
  assert.deepEqual(moveSession([1, 2, 3], 2, 0), [3, 1, 2]);
  assert.deepEqual(moveSession([1, 2, 3], 0, 3), [2, 3, 1]);
});

test("a drop back where it started changes nothing", () => {
  const order = [1, 2, 3];
  assert.equal(moveSession(order, 1, 1), order);
  assert.equal(moveSession(order, 1, 2), order);
  assert.equal(moveSession(order, 0, 0), order);
});

test("an out-of-range drop is clamped, and an unknown row is left alone", () => {
  assert.deepEqual(moveSession([1, 2, 3], 0, 99), [2, 3, 1]);
  assert.deepEqual(moveSession([1, 2, 3], 2, -5), [3, 1, 2]);
  const order = [1, 2, 3];
  assert.equal(moveSession(order, 7, 0), order);
});

test("formats token counts", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(undefined), "0");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1500), "1.5k");
  assert.equal(formatTokens(2_400_000), "2.4M");
});
