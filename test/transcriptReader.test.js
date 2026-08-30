const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TranscriptReader } = require("../src/transcriptReader");

const entry = (obj) => JSON.stringify(obj) + "\n";
const assistant = (text) =>
  entry({ type: "assistant", message: { content: [{ type: "text", text }] } });

const usageEntry = (usage, extra = {}) =>
  entry({
    type: "assistant",
    cwd: "/Users/me/projects/demo",
    gitBranch: "main",
    ...extra,
    message: { model: "claude-opus-5", content: [{ type: "text", text: "hi" }], usage },
  });

const usage = (input, output, cacheRead, cacheCreation) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreation,
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac-reader-test-"));
  const pointer = path.join(dir, "pointer");
  const transcript = path.join(dir, "session.jsonl");
  const spoken = [];
  const statsSeen = [];
  const statuses = [];
  const answers = [];
  const reader = new TranscriptReader(pointer, {
    onReply: (text) => spoken.push(text),
    onStats: (stats) => statsSeen.push(stats),
    onStatus: (status) => statuses.push(status),
    onAnswer: () => answers.push(true),
  });
  return { dir, pointer, transcript, spoken, statsSeen, statuses, answers, reader };
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
  fs.appendFileSync(
    transcript,
    entry({ type: "user", message: { content: [{ type: "text", text: "my prompt" }] } }),
  );
  fs.appendFileSync(
    transcript,
    entry({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
    }),
  );
  fs.appendFileSync(
    transcript,
    entry({
      type: "assistant",
      isSidechain: true,
      message: { content: [{ type: "text", text: "subagent chatter" }] },
    }),
  );
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
      message: {
        content: [
          { type: "text", text: "First part." },
          { type: "tool_use", name: "Read" },
          { type: "text", text: "Second part." },
        ],
      },
    }),
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

test("accumulates token totals and reports context from the latest turn", () => {
  const { pointer, transcript, statsSeen, reader } = setup();
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(pointer, transcript);
  fs.appendFileSync(transcript, usageEntry(usage(10, 100, 0, 5000)));
  fs.appendFileSync(transcript, usageEntry(usage(2, 250, 5000, 300)));
  reader.poll();

  const stats = statsSeen.at(-1);
  assert.equal(stats.inputTokens, 12);
  assert.equal(stats.outputTokens, 350);
  assert.equal(stats.cacheReadTokens, 5000);
  assert.equal(stats.cacheCreationTokens, 5300);
  assert.equal(stats.messages, 2);
  assert.equal(stats.contextTokens, 2 + 5000 + 300 + 250);
  assert.equal(stats.model, "claude-opus-5");
  assert.equal(stats.cwd, "/Users/me/projects/demo");
  assert.equal(stats.gitBranch, "main");
});

test("counts history usage even when reading was never enabled", () => {
  const { pointer, transcript, statsSeen, spoken, reader } = setup();
  fs.writeFileSync(transcript, usageEntry(usage(5, 50, 0, 100)));
  fs.writeFileSync(pointer, transcript);
  reader.poll();
  assert.deepEqual(spoken, []);
  assert.equal(statsSeen.at(-1).outputTokens, 50);
});

test("counts subagent tokens but keeps them out of context and message count", () => {
  const { pointer, transcript, statsSeen, reader } = setup();
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(pointer, transcript);
  fs.appendFileSync(transcript, usageEntry(usage(1, 10, 20, 30)));
  fs.appendFileSync(transcript, usageEntry(usage(7, 70, 700, 7000), { isSidechain: true }));
  reader.poll();

  const stats = statsSeen.at(-1);
  assert.equal(stats.outputTokens, 80);
  assert.equal(stats.messages, 1);
  assert.equal(stats.contextTokens, 1 + 20 + 30 + 10);
});

test("resets stats when the session changes", () => {
  const { dir, pointer, transcript, statsSeen, reader } = setup();
  fs.writeFileSync(transcript, usageEntry(usage(10, 100, 0, 500)));
  fs.writeFileSync(pointer, transcript);
  reader.poll();
  assert.equal(statsSeen.at(-1).outputTokens, 100);

  const next = path.join(dir, "session-two.jsonl");
  fs.writeFileSync(next, usageEntry(usage(1, 2, 3, 4)));
  fs.writeFileSync(pointer, next);
  reader.poll();
  assert.equal(statsSeen.at(-1).outputTokens, 2);
  assert.equal(statsSeen.at(-1).messages, 1);
});

const userEntry = (extra = {}) =>
  entry({ type: "user", ...extra, message: { content: "do the thing" } });

const toolUse = () =>
  entry({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
  });

function primed() {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, "");
  fs.writeFileSync(ctx.pointer, ctx.transcript);
  ctx.reader.poll();
  ctx.statuses.length = 0;
  return ctx;
}

test("a user entry marks the session working", () => {
  const { transcript, statuses, reader } = primed();
  fs.appendFileSync(transcript, userEntry());
  reader.poll();
  assert.deepEqual(statuses, ["working"]);
  assert.equal(reader.status, "working");
});

test("an assistant reply returns the session to idle and reports an answer", () => {
  const { transcript, statuses, answers, reader } = primed();
  fs.appendFileSync(transcript, userEntry() + assistant("Done."));
  reader.poll();
  assert.deepEqual(statuses, ["working", "idle"]);
  assert.deepEqual(answers, [true]);
});

test("stays working through a tool loop", () => {
  const { transcript, statuses, reader } = primed();
  fs.appendFileSync(transcript, userEntry() + toolUse() + userEntry());
  reader.poll();
  assert.deepEqual(statuses, ["working"]);
  assert.equal(reader.status, "working");
});

test("repeats do not re-emit the same status", () => {
  const { transcript, statuses, reader } = primed();
  fs.appendFileSync(transcript, userEntry() + userEntry() + userEntry());
  reader.poll();
  assert.deepEqual(statuses, ["working"]);
});

test("sidechain user entries do not change status", () => {
  const { transcript, statuses, reader } = primed();
  fs.appendFileSync(transcript, userEntry({ isSidechain: true }));
  reader.poll();
  assert.deepEqual(statuses, []);
  assert.equal(reader.status, "idle");
});

test("reports an answer even while reading is disabled", () => {
  const { transcript, spoken, answers, reader } = primed();
  fs.appendFileSync(transcript, assistant("Quiet reply."));
  reader.poll();
  assert.deepEqual(spoken, []);
  assert.deepEqual(answers, [true]);
});

test("switching transcript resets the status to idle", () => {
  const { dir, pointer, transcript, statuses, reader } = primed();
  fs.appendFileSync(transcript, userEntry());
  reader.poll();
  assert.equal(reader.status, "working");

  const next = path.join(dir, "other.jsonl");
  fs.writeFileSync(next, "");
  fs.writeFileSync(pointer, next);
  reader.poll();
  assert.equal(reader.status, "idle");
  assert.deepEqual(statuses, ["working", "idle"]);
});
