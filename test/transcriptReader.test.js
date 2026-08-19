const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TranscriptReader } = require("../src/transcriptReader");

const entry = (obj) => JSON.stringify(obj) + "\n";
const assistant = (text) => entry({ type: "assistant", message: { content: [{ type: "text", text }] } });

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac-reader-test-"));
  const pointer = path.join(dir, "pointer");
  const transcript = path.join(dir, "session.jsonl");
  const spoken = [];
  const reader = new TranscriptReader(pointer, (text) => spoken.push(text));
  return { dir, pointer, transcript, spoken, reader };
}

test("speaks a new assistant message", () => {
  const { pointer, transcript, spoken, reader } = setup();
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(pointer, transcript);
  reader.enable();
  fs.appendFileSync(transcript, assistant("Hello there."));
  reader.poll();
  assert.deepEqual(spoken, ["Hello there."]);
});

test("does not speak history that predates enabling", () => {
  const { pointer, transcript, spoken, reader } = setup();
  fs.writeFileSync(transcript, assistant("Old message from before."));
  fs.writeFileSync(pointer, transcript);
  reader.enable();
  reader.poll();
  assert.deepEqual(spoken, []);
});

test("stays silent while disabled and resumes at the live end", () => {
  const { pointer, transcript, spoken, reader } = setup();
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(pointer, transcript);
  reader.enable();
  reader.disable();
  fs.appendFileSync(transcript, assistant("Spoken to nobody."));
  reader.poll();
  assert.deepEqual(spoken, []);
  reader.enable();
  fs.appendFileSync(transcript, assistant("Now listening."));
  reader.poll();
  assert.deepEqual(spoken, ["Now listening."]);
});

test("ignores user entries, tool calls and subagent messages", () => {
  const { pointer, transcript, spoken, reader } = setup();
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(pointer, transcript);
  reader.enable();
  fs.appendFileSync(transcript, entry({ type: "user", message: { content: [{ type: "text", text: "my prompt" }] } }));
  fs.appendFileSync(transcript, entry({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } }));
  fs.appendFileSync(transcript, entry({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "subagent chatter" }] } }));
  reader.poll();
  assert.deepEqual(spoken, []);
});

test("joins several text blocks of one message", () => {
  const { pointer, transcript, spoken, reader } = setup();
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(pointer, transcript);
  reader.enable();
  fs.appendFileSync(
    transcript,
    entry({
      type: "assistant",
      message: { content: [{ type: "text", text: "First part." }, { type: "tool_use", name: "Read" }, { type: "text", text: "Second part." }] },
    })
  );
  reader.poll();
  assert.deepEqual(spoken, ["First part. Second part."]);
});

test("waits for a line to be written completely", () => {
  const { pointer, transcript, spoken, reader } = setup();
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(pointer, transcript);
  reader.enable();
  const line = assistant("Written in two writes.");
  fs.appendFileSync(transcript, line.slice(0, 30));
  reader.poll();
  assert.deepEqual(spoken, []);
  fs.appendFileSync(transcript, line.slice(30));
  reader.poll();
  assert.deepEqual(spoken, ["Written in two writes."]);
});

test("follows the pointer to a new session without speaking its history", () => {
  const { dir, pointer, transcript, spoken, reader } = setup();
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(pointer, transcript);
  reader.enable();

  const next = path.join(dir, "session-two.jsonl");
  fs.writeFileSync(next, assistant("History of the new session."));
  fs.writeFileSync(pointer, next);
  reader.poll();
  assert.deepEqual(spoken, []);

  fs.appendFileSync(next, assistant("Reply after clearing."));
  reader.poll();
  assert.deepEqual(spoken, ["Reply after clearing."]);
});

test("survives a missing pointer or transcript", () => {
  const { pointer, spoken, reader } = setup();
  reader.enable();
  reader.poll();
  fs.writeFileSync(pointer, "/nonexistent/path/session.jsonl");
  reader.poll();
  assert.deepEqual(spoken, []);
});

test("ignores malformed json lines", () => {
  const { pointer, transcript, spoken, reader } = setup();
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(pointer, transcript);
  reader.enable();
  fs.appendFileSync(transcript, "{ not valid json\n");
  fs.appendFileSync(transcript, assistant("Still fine."));
  reader.poll();
  assert.deepEqual(spoken, ["Still fine."]);
});
