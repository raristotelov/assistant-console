// Downloads and runs code-server (VS Code's workbench over HTTP).
// One server process per session, bound to localhost on an ephemeral port.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const https = require("node:https");
const { spawn, execFileSync } = require("node:child_process");

const VERSION = "4.135.0";
const READY_TIMEOUT_MS = 60000;

function assetName() {
  const platform = process.platform === "darwin" ? "macos" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return `code-server-${VERSION}-${platform}-${arch}`;
}

function downloadUrl() {
  return `https://github.com/coder/code-server/releases/download/v${VERSION}/${assetName()}.tar.gz`;
}

function fetchToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "user-agent": "assistant-console" } }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        fetchToFile(headers.location, dest).then(resolve, reject);
        return;
      }
      if (statusCode !== 200) {
        res.resume();
        reject(new Error(`download failed: HTTP ${statusCode}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });
    req.on("error", reject);
  });
}

async function ensureBinary(rootDir) {
  if (process.platform === "win32") {
    throw new Error("code-server publishes no Windows build");
  }
  const bin = path.join(rootDir, assetName(), "bin", "code-server");
  if (fs.existsSync(bin)) return bin;

  fs.mkdirSync(rootDir, { recursive: true });
  const tarball = path.join(rootDir, `${assetName()}.tar.gz`);
  await fetchToFile(downloadUrl(), tarball);
  execFileSync("tar", ["-xzf", tarball, "-C", rootDir]);
  fs.unlinkSync(tarball);

  if (!fs.existsSync(bin)) throw new Error("code-server binary missing after extract");
  return bin;
}

const SEEDED_ENTRIES = ["settings.json", "keybindings.json", "snippets"];

function desktopUserDir() {
  const home = os.homedir();
  return process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Code", "User")
    : path.join(home, ".config", "Code", "User");
}

function desktopExtensionsDir() {
  return path.join(os.homedir(), ".vscode", "extensions");
}

function seedTemplate(templateDir) {
  const templateUser = path.join(templateDir, "User");
  if (fs.existsSync(templateUser)) return;
  fs.mkdirSync(templateUser, { recursive: true });

  const from = desktopUserDir();
  if (!fs.existsSync(from)) return;
  for (const entry of SEEDED_ENTRIES) {
    const src = path.join(from, entry);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(templateUser, entry), { recursive: true });
  }
}

async function seedExtensions(extensionsDir) {
  fs.mkdirSync(extensionsDir, { recursive: true });
  const present = fs.readdirSync(extensionsDir, { withFileTypes: true });
  if (present.some((entry) => entry.isDirectory())) return;

  const from = desktopExtensionsDir();
  if (!fs.existsSync(from)) return;
  await fs.promises.cp(from, extensionsDir, { recursive: true, force: true });
}

function seedUserData(userDataDir, templateDir) {
  const templateUser = path.join(templateDir, "User");
  const targetUser = path.join(userDataDir, "User");
  fs.mkdirSync(targetUser, { recursive: true });

  for (const entry of SEEDED_ENTRIES) {
    const src = path.join(templateUser, entry);
    const dest = path.join(targetUser, entry);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  }
}

const IDE_LOCK_DIR = path.join(os.homedir(), ".claude", "ide");
const IDE_LOCK_TIMEOUT_MS = 120000;
const IDE_LOCK_POLL_MS = 500;

function readIdeLock(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(IDE_LOCK_DIR, file), "utf8"));
  } catch {
    return null;
  }
}

async function findIdePort(folder) {
  const deadline = Date.now() + IDE_LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let files = [];
    try {
      files = fs.readdirSync(IDE_LOCK_DIR).filter((f) => f.endsWith(".lock"));
    } catch {}

    for (const file of files) {
      const lock = readIdeLock(file);
      if (lock?.ideName !== "code-server") continue;
      if (!lock.workspaceFolders?.includes(folder)) continue;
      return Number(path.basename(file, ".lock"));
    }
    await new Promise((r) => setTimeout(r, IDE_LOCK_POLL_MS));
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

async function waitUntilServing(port, isAlive) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error("code-server exited before it started serving");
    if (await canConnect(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("code-server did not start within 60s");
}

async function start({ rootDir, folder, userDataDir, extensionsDir, templateDir }) {
  const bin = await ensureBinary(rootDir);
  seedTemplate(templateDir);
  seedUserData(userDataDir, templateDir);
  await seedExtensions(extensionsDir);
  const port = await freePort();

  const proc = spawn(
    bin,
    [
      "--bind-addr", `127.0.0.1:${port}`,
      "--auth", "none",
      "--disable-telemetry",
      "--disable-update-check",
      "--user-data-dir", userDataDir,
      "--extensions-dir", extensionsDir,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let exited = false;
  proc.on("exit", () => { exited = true; });
  proc.stderr.on("data", (d) => console.error(`[code-server] ${d}`));

  await waitUntilServing(port, () => !exited);

  return {
    proc,
    port,
    url: `http://127.0.0.1:${port}/?folder=${encodeURIComponent(folder)}`,
  };
}

module.exports = { start, findIdePort, VERSION };
