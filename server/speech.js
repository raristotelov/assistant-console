// Speech-to-text (whisper.cpp) and text-to-speech (Piper) as local subprocesses.
// Both are placeholders wired to real CLIs — set the paths below to your installs.
// The rest of the app doesn't care which engines these are; swap freely later.

import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- CONFIGURE THESE for your machine -------------------------------------
const WHISPER_BIN = process.env.WHISPER_BIN || "whisper-cli"; // whisper.cpp binary
const WHISPER_MODEL =
  process.env.WHISPER_MODEL || "models/ggml-small.bin";       // downloaded model
const PIPER_BIN = process.env.PIPER_BIN || "piper";           // piper binary
const PIPER_VOICE =
  process.env.PIPER_VOICE || "voices/en_US-amy-medium.onnx";  // piper voice model
// --------------------------------------------------------------------------

/**
 * Transcribe a WAV buffer (16kHz mono) to text via whisper.cpp.
 * @param {Buffer} wavBuffer
 * @returns {Promise<string>}
 */
export async function transcribe(wavBuffer) {
  const dir = await mkdtemp(join(tmpdir(), "vc-stt-"));
  const wavPath = join(dir, "in.wav");
  try {
    await writeFile(wavPath, wavBuffer);
    // whisper.cpp: -nt = no timestamps, -otxt writes <file>.txt, -m model
    const outText = await run(WHISPER_BIN, [
      "-m", WHISPER_MODEL,
      "-f", wavPath,
      "-nt",
      "-otxt",
    ]);
    // Some builds print the transcript to stdout; others only to the .txt file.
    if (outText.trim()) return outText.trim();
    const txt = await readFile(`${wavPath}.txt`, "utf8").catch(() => "");
    return txt.trim();
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Synthesize text to a WAV buffer via Piper.
 * @param {string} text
 * @returns {Promise<Buffer>} WAV audio
 */
export async function synthesize(text) {
  const dir = await mkdtemp(join(tmpdir(), "vc-tts-"));
  const outPath = join(dir, "out.wav");
  try {
    // Piper reads text from stdin, writes WAV to --output_file
    await run(
      PIPER_BIN,
      ["--model", PIPER_VOICE, "--output_file", outPath],
      text
    );
    return await readFile(outPath);
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Run a command, optionally piping `input` to stdin, resolve stdout.
function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err}`))
    );
    if (input !== undefined) {
      p.stdin.write(input);
      p.stdin.end();
    }
  });
}
