const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { fetchToFile, extractTarGz } = require("./download");

const WHISPER_MODEL_FILE = "ggml-small.bin";
const WHISPER_MODEL_URL =
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}`;

const PYTHON_TAG = "20260825";
const PYTHON_VERSION = "3.11.16";

function pythonAsset() {
  if (process.platform !== "darwin") {
    throw new Error(`no python build configured for ${process.platform}`);
  }
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  return `cpython-${PYTHON_VERSION}+${PYTHON_TAG}-${arch}-apple-darwin-install_only.tar.gz`;
}

function pythonUrl() {
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_TAG}/${pythonAsset()}`;
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(bin)} exited with ${code}`));
    });
  });
}

async function ensureWhisperModel(rootDir, onStatus) {
  const dest = path.join(rootDir, "models", WHISPER_MODEL_FILE);
  if (fs.existsSync(dest)) return dest;

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  onStatus("downloading speech model");
  await fetchToFile(WHISPER_MODEL_URL, dest);
  return dest;
}

async function ensurePython(rootDir, onStatus) {
  const bin = path.join(rootDir, "python", "bin", "python3");
  if (fs.existsSync(bin)) return bin;

  fs.mkdirSync(rootDir, { recursive: true });
  const tarball = path.join(rootDir, pythonAsset());

  onStatus("downloading python");
  await fetchToFile(pythonUrl(), tarball);
  extractTarGz(tarball, rootDir);
  fs.unlinkSync(tarball);

  onStatus("installing kokoro, this takes a few minutes");
  await run(bin, ["-m", "pip", "install", "--no-input", "kokoro"]);
  return bin;
}

module.exports = { ensureWhisperModel, ensurePython };
