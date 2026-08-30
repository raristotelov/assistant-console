// Electron main process.
// Owns the window and one pty terminal per session, each running your shell.
// Voice: STT/TTS handlers, per-session transcript reading, spoken replies.

require("dotenv/config"); // load paths (WHISPER_BIN, KOKORO_PYTHON, ...) from .env

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const crypto = require("node:crypto");
const pty = require("node-pty");
const codeServer = require("./codeServer");
const { transcribe, TtsEngine, configure } = require("./speech");
const { ensureWhisperModel, ensurePython } = require("./provision");
const { TranscriptReader } = require("./transcriptReader");
const { toSpeakable } = require("./speakable");

const SUBMIT_KEY_DELAY_MS = 150;

let win;
let tts;
let replyId = 0;
const replySessions = new Map();
let nextSessionId = 0;
const sessions = new Map();

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#24292e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  win.maximize();
  win.loadFile(path.join(__dirname, "index.html"));
  win.on("closed", () => {
    win = null;
    for (const id of [...sessions.keys()]) closeSession(id);
  });
}

function send(channel, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

async function createSession() {
  const picked = await dialog.showOpenDialog(win, {
    title: "Choose a project folder",
    buttonLabel: "Open session",
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked.canceled || !picked.filePaths.length) return null;

  const id = ++nextSessionId;
  const folder = picked.filePaths[0];
  sessions.set(id, { id, folder, term: null, reader: null, pointerFile: null, editor: null });
  return { id, folder };
}

let voiceReady = null;

function ensureVoiceReady() {
  if (voiceReady) return voiceReady;

  const rootDir = app.getPath("userData");
  const onStatus = (text) => send("voice:status", text);

  voiceReady = (async () => {
    const model = await ensureWhisperModel(rootDir, onStatus);
    const python = await ensurePython(rootDir, onStatus);
    configure({ model, python });
    onStatus("");
    tts.start();
  })();

  voiceReady.catch((e) => {
    voiceReady = null;
    onStatus(`voice setup failed: ${e.message || e}`);
  });

  return voiceReady;
}

const INHERITED_EDITOR_KEYS = ["TERM_PROGRAM", "TERM_PROGRAM_VERSION", "CLAUDE_CODE_SSE_PORT"];

function shellEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (INHERITED_EDITOR_KEYS.includes(key)) continue;
    if (key.startsWith("VSCODE_")) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

function openTerminal(id) {
  const session = sessions.get(id);
  if (!session || session.term) return;

  const pointerFile = path.join(os.tmpdir(), `assistant-console-session-${process.pid}-${id}`);
  const shell = os.platform() === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/zsh";

  const term = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 100,
    rows: 30,
    cwd: session.folder,
    env: shellEnv({
      ASSISTANT_CONSOLE_SESSION_FILE: pointerFile,
      ...(session.idePort ? { CLAUDE_CODE_SSE_PORT: String(session.idePort) } : {}),
    }),
  });

  term.onData((data) => send("term:data", { id, data }));
  term.onExit(() => send("term:exit", { id }));

  const reader = new TranscriptReader(pointerFile, {
    onReply: (text) => {
      const speakable = toSpeakable(text);
      if (!speakable) return;
      replySessions.set(++replyId, id);
      tts.speak(replyId, speakable);
    },
    onStats: (stats) => send("session:stats", { id, stats }),
    onStatus: (status) => send("session:status", { id, status }),
    onAnswer: () => send("session:answer", { id }),
  });
  reader.start();

  Object.assign(session, { term, reader, pointerFile });
}

async function openEditor(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (session.editor) return { url: session.editor.url };

  const rootDir = path.join(app.getPath("userData"), "code-server");
  const folderKey = crypto.createHash("sha1").update(session.folder).digest("hex").slice(0, 12);

  session.editor = await codeServer.start({
    rootDir,
    folder: session.folder,
    userDataDir: path.join(rootDir, "user-data", folderKey),
    extensionsDir: path.join(rootDir, "extensions"),
    templateDir: path.join(rootDir, "user-data-template"),
  });

  codeServer.findIdePort(session.folder).then((port) => {
    if (!port || sessions.get(id) !== session) return;
    session.idePort = port;
    exportIdePort(session, port);
  });

  return { url: session.editor.url };
}

function exportIdePort(session, port) {
  const shellName = path.basename(process.env.SHELL || "zsh");
  if (!session.term || session.term.process !== shellName) return;
  session.term.write(`export CLAUDE_CODE_SSE_PORT=${port}\r`);
}

function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  session.reader?.stop();
  session.term?.kill();
  session.editor?.proc.kill();
  if (session.pointerFile) {
    try {
      fs.unlinkSync(session.pointerFile);
    } catch {}
  }
  sessions.delete(id);
}

app.whenReady().then(() => {
  createWindow();

  tts = new TtsEngine({
    onChunk: (header, wav) => {
      send("voice:audio-chunk", {
        id: header.id,
        sessionId: replySessions.get(header.id) ?? null,
        seq: header.seq,
        last: header.last,
        wav: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
      });
      if (header.last) replySessions.delete(header.id);
    },
    onError: (msg) => console.error(`[tts] ${msg}`),
  });

  ipcMain.handle("session:create", () => createSession());
  ipcMain.on("session:close", (_e, id) => closeSession(id));

  ipcMain.handle("term:open", (_e, id) => openTerminal(id));
  ipcMain.handle("editor:open", (_e, id) => openEditor(id));

  ipcMain.on("term:input", (_e, { id, data }) => sessions.get(id)?.term?.write(data));
  ipcMain.on("term:resize", (_e, { id, cols, rows }) => sessions.get(id)?.term?.resize(cols, rows));
  ipcMain.on("term:send-line", (_e, { id, text }) => {
    const session = sessions.get(id);
    if (!session?.term) return;
    session.term.write(text);
    setTimeout(() => sessions.get(id)?.term?.write("\r"), SUBMIT_KEY_DELAY_MS);
  });

  // reading toggle, per session — when off, that session's replies aren't spoken.
  ipcMain.on("voice:reading", (_e, { id, on }) => {
    const session = sessions.get(id);
    if (!session?.reader) return;
    if (on) {
      ensureVoiceReady().catch(() => {});
      session.reader.enable();
    } else {
      session.reader.disable();
    }
  });

  ipcMain.on("voice:cancel", () => {
    tts?.cancel(replyId);
    send("voice:cancelled", replyId);
  });

  // STT: renderer sends a captured utterance (WAV), we return the transcript.
  ipcMain.handle("voice:transcribe", async (_e, arrayBuffer) => {
    await ensureVoiceReady();
    const buf = Buffer.from(arrayBuffer);
    return await transcribe(buf);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const id of [...sessions.keys()]) closeSession(id);
  tts?.stop();
  if (process.platform !== "darwin") app.quit();
});
