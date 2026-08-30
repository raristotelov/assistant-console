const test = require("node:test");
const assert = require("node:assert/strict");
const { TtsEngine } = require("../src/speech");

function makeEngine() {
  const chunks = [];
  const errors = [];
  const engine = new TtsEngine({
    onChunk: (header, wav) => chunks.push({ header, wav }),
    onError: (msg) => errors.push(msg),
  });
  return { engine, chunks, errors };
}

function frame(header, payload) {
  return Buffer.concat([Buffer.from(JSON.stringify(header) + "\n"), payload]);
}

test("marks itself ready on the ready header", () => {
  const { engine } = makeEngine();
  engine.consume(Buffer.from(JSON.stringify({ ready: true }) + "\n"));
  assert.equal(engine.ready, true);
});

test("emits a chunk with the exact payload bytes", () => {
  const { engine, chunks } = makeEngine();
  const payload = Buffer.from([1, 2, 3, 4, 5]);
  engine.consume(frame({ id: 1, seq: 0, len: payload.length, last: true }, payload));
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0].header, { id: 1, seq: 0, len: 5, last: true });
  assert.deepEqual(chunks[0].wav, payload);
});

test("reassembles a payload split across writes", () => {
  const { engine, chunks } = makeEngine();
  const payload = Buffer.from([9, 8, 7, 6, 5, 4]);
  const full = frame({ id: 2, seq: 1, len: payload.length, last: false }, payload);
  engine.consume(full.subarray(0, full.length - 4));
  assert.equal(chunks.length, 0);
  engine.consume(full.subarray(full.length - 4));
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0].wav, payload);
});

test("handles several frames arriving in one write", () => {
  const { engine, chunks } = makeEngine();
  const a = Buffer.from([1, 1, 1]);
  const b = Buffer.from([2, 2]);
  engine.consume(
    Buffer.concat([
      frame({ id: 3, seq: 0, len: a.length, last: false }, a),
      frame({ id: 3, seq: 1, len: b.length, last: true }, b),
    ]),
  );
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].wav, a);
  assert.deepEqual(chunks[1].wav, b);
  assert.equal(chunks[1].header.last, true);
});

test("does not treat newline bytes inside audio as a frame boundary", () => {
  const { engine, chunks } = makeEngine();
  const payload = Buffer.from([0x0a, 0x7b, 0x0a, 0x0a, 0x22]);
  engine.consume(frame({ id: 4, seq: 0, len: payload.length, last: true }, payload));
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0].wav, payload);
});

test("reports worker errors", () => {
  const { engine, errors } = makeEngine();
  engine.consume(Buffer.from(JSON.stringify({ id: 5, error: "voice exploded" }) + "\n"));
  assert.deepEqual(errors, ["voice exploded"]);
});

test("ignores unparsable lines", () => {
  const { engine, chunks, errors } = makeEngine();
  engine.consume(Buffer.from("not json at all\n"));
  assert.equal(chunks.length, 0);
  assert.equal(errors.length, 0);
});
