const test = require("node:test");
const assert = require("node:assert/strict");
const { toSpeakable } = require("../src/speakable");

const NOTICE = "There's something in the terminal you need to see.";
const norm = (s) => s.replace(/\s+/g, " ").trim();

test("keeps plain prose untouched", () => {
  assert.equal(toSpeakable("Plain sentence, nothing fancy."), "Plain sentence, nothing fancy.");
});

test("strips emphasis and inline code markers", () => {
  assert.equal(
    norm(toSpeakable("**Bold** and *italic* and `inline code` stay as words.")),
    "Bold and italic and inline code stay as words."
  );
  assert.equal(norm(toSpeakable("__strong__ and _quiet_ words")), "strong and quiet words");
});

test("strips heading, list and quote markers", () => {
  assert.equal(
    norm(toSpeakable("## Heading\n- bullet one\n* bullet two\n1. numbered\n> quoted")),
    "Heading bullet one bullet two numbered quoted"
  );
});

test("keeps link text and drops the url", () => {
  assert.equal(
    norm(toSpeakable("See [the docs](https://example.com/x) for more.")),
    "See the docs for more."
  );
});

test("skips fenced code and appends the notice", () => {
  assert.equal(
    norm(toSpeakable("Here:\n```js\nconst x = 1;\n```\nDone.")),
    norm(`Here: Done. ${NOTICE}`)
  );
});

test("speaks only the notice when the reply is nothing but code", () => {
  assert.equal(norm(toSpeakable("```\nonly code\n```")), NOTICE);
});

test("skips an unclosed fence rather than reading it", () => {
  assert.equal(
    norm(toSpeakable("Unclosed fence:\n```js\nconst y = 2;")),
    norm(`Unclosed fence: ${NOTICE}`)
  );
});

test("skips tables and appends the notice", () => {
  assert.equal(
    norm(toSpeakable("| a | b |\n|---|---|\n| 1 | 2 |\nAfter table.")),
    norm(`After table. ${NOTICE}`)
  );
});

test("removes emoji, including modifiers and zwj sequences", () => {
  assert.equal(norm(toSpeakable("Done! 🎉 Tests pass ✅ ready 🚀")), "Done! Tests pass ready");
  assert.equal(norm(toSpeakable("Thumbs 👍🏽 family 👨‍👩‍👧 done")), "Thumbs family done");
});

test("spells out short all-caps acronyms", () => {
  assert.equal(toSpeakable("Open the PR and check the API via MCP."), "Open the P R and check the A P I via M C P.");
  assert.equal(toSpeakable("Two PRs are waiting."), "Two P Rs are waiting.");
});

test("leaves ordinary capitalised words alone", () => {
  assert.equal(toSpeakable("A normal Sentence stays."), "A normal Sentence stays.");
  assert.equal(toSpeakable("LONGER stays too."), "LONGER stays too.");
});

test("returns an empty string for empty input", () => {
  assert.equal(toSpeakable(""), "");
  assert.equal(toSpeakable("   \n  "), "");
});
