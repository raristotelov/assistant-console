const test = require("node:test");
const assert = require("node:assert/strict");
const { speechOnly } = require("../src/speech");

test("drops parenthesised non-speech annotations", () => {
  assert.equal(speechOnly("(clears throat)"), "");
  assert.equal(speechOnly("(sniffles)"), "");
  assert.equal(speechOnly("(sobbing)"), "");
});

test("drops bracketed annotations and blank-audio markers", () => {
  assert.equal(speechOnly("[coughing]"), "");
  assert.equal(speechOnly("[BLANK_AUDIO]"), "");
});

test("drops asterisk and music annotations", () => {
  assert.equal(speechOnly("*laughs*"), "");
  assert.equal(speechOnly("♪ music playing ♪"), "");
});

test("drops output with no letters or digits", () => {
  assert.equal(speechOnly("   ...   "), "");
  assert.equal(speechOnly(""), "");
});

test("keeps real speech", () => {
  assert.equal(speechOnly("Run the tests now."), "Run the tests now.");
});

test("keeps real speech mixed with annotations", () => {
  assert.equal(
    speechOnly("(clears throat) let's continue with ticket twelve"),
    "let's continue with ticket twelve"
  );
  assert.equal(speechOnly("[coughing] can you check the board *laughs*"), "can you check the board");
});

test("keeps non-latin speech", () => {
  assert.equal(speechOnly("Кажи ми нещо на български"), "Кажи ми нещо на български");
});
