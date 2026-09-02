const test = require("node:test");
const assert = require("node:assert/strict");
const { createShutdown } = require("../src/shutdown");

const spy = () => {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  return fn;
};

test("closes the sessions, stops speech, then quits", () => {
  const order = [];
  const shutdown = createShutdown({
    closeSessions: () => order.push("sessions"),
    stopTts: () => order.push("tts"),
    quit: () => order.push("quit"),
  });
  shutdown();
  assert.deepEqual(order, ["sessions", "tts", "quit"]);
});

test("a second signal does nothing", () => {
  const closeSessions = spy();
  const stopTts = spy();
  const quit = spy();
  const shutdown = createShutdown({ closeSessions, stopTts, quit });
  shutdown();
  shutdown();
  shutdown();
  assert.equal(closeSessions.calls.length, 1);
  assert.equal(stopTts.calls.length, 1);
  assert.equal(quit.calls.length, 1);
});
