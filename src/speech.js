// Local speech engines for the Electron main process.
// STT: whisper.cpp   TTS: kokoro via a resident worker (src/tts_worker.py).
// Paths come from env vars (set in a .env or the shell that launches the app).

const { spawn } = require("node:child_process");
const { writeFile, readFile, mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const WHISPER_BIN = process.env.WHISPER_BIN || "whisper-cli";
const WHISPER_MODEL = process.env.WHISPER_MODEL || "models/ggml-small.bin";
const KOKORO_PYTHON = process.env.KOKORO_PYTHON || "python3";
const TTS_WORKER = join(__dirname, "tts_worker.py");

// Whisper marks non-speech sounds as annotations — (clears throat), [coughing],
// *laughs*, [BLANK_AUDIO]. Drop them; if nothing sayable is left, it wasn't speech.
function speechOnly(text) {
  const cleaned = text
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\*[^*]*\*/g, " ")
    .replace(/♪[^♪]*♪/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}

// Transcribe a WAV buffer (16kHz mono) -> text.
async function transcribe(wavBuffer) {
  const dir = await mkdtemp(join(tmpdir(), "ac-stt-"));
  const wavPath = join(dir, "in.wav");
  try {
    await writeFile(wavPath, wavBuffer);
    const out = await run(WHISPER_BIN, ["-m", WHISPER_MODEL, "-f", wavPath, "-nt", "-otxt"]);
    if (out.trim()) return speechOnly(out.trim());
    const txt = await readFile(`${wavPath}.txt`, "utf8").catch(() => "");
    return speechOnly(txt.trim());
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Resident TTS worker: loads the voice model once, then synthesizes each
// utterance sentence-by-sentence and streams WAV chunks back as they finish.
class TtsEngine {
  constructor({ onChunk, onError }) {
    this.onChunk = onChunk;
    this.onError = onError;
    this.proc = null;
    this.ready = false;
    this.stopped = false;
    this.buffer = Buffer.alloc(0);
    this.awaiting = null;
  }

  start() {
    if (this.proc || this.stopped) return;
    this.proc = spawn(KOKORO_PYTHON, [TTS_WORKER], { env: process.env });
    this.proc.stdout.on("data", (data) => this.consume(data));
    this.proc.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) this.onError(msg);
    });
    this.proc.on("error", (e) => this.onError(String(e.message || e)));
    this.proc.on("close", () => {
      this.proc = null;
      this.ready = false;
      this.buffer = Buffer.alloc(0);
      this.awaiting = null;
      if (!this.stopped) setTimeout(() => this.start(), 1000);
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
    this.proc = null;
  }

  speak(id, text) {
    this.send({ id, text });
  }

  cancel(id) {
    this.send({ cancel: id });
  }

  send(msg) {
    if (!this.proc) this.start();
    try {
      this.proc?.stdin.write(JSON.stringify(msg) + "\n");
    } catch (e) {
      this.onError(String(e.message || e));
    }
  }

  consume(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (true) {
      if (this.awaiting) {
        if (this.buffer.length < this.awaiting.len) return;
        const wav = this.buffer.subarray(0, this.awaiting.len);
        this.buffer = this.buffer.subarray(this.awaiting.len);
        const header = this.awaiting;
        this.awaiting = null;
        this.onChunk(header, Buffer.from(wav));
        continue;
      }
      const nl = this.buffer.indexOf(0x0a);
      if (nl === -1) return;
      const line = this.buffer.subarray(0, nl).toString("utf8").trim();
      this.buffer = this.buffer.subarray(nl + 1);
      if (!line) continue;
      let header;
      try {
        header = JSON.parse(line);
      } catch {
        continue;
      }
      if (header.ready) {
        this.ready = true;
      } else if (header.error) {
        this.onError(header.error);
      } else if (typeof header.len === "number") {
        this.awaiting = header;
      }
    }
  }
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err}`))
    );
    if (input !== undefined) { p.stdin.write(input); p.stdin.end(); }
  });
}

module.exports = { transcribe, TtsEngine, speechOnly };
