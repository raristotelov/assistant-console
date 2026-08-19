// Electron main process.
// Owns the window and the real terminal (pty) running your shell + claude.
// Adds voice: STT/TTS handlers and reply-capture so spoken replies work.

require("dotenv/config"); // load paths (WHISPER_BIN, PIPER_VOICE, ...) from .env

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
const pty = require("node-pty");
const { transcribe, TtsEngine } = require("./speech");
const { TranscriptReader } = require("./transcriptReader");
const { toSpeakable } = require("./speakable");

const sessionPointerFile = path.join(
  os.tmpdir(),
  `assistant-console-session-${process.pid}`
);

const SUBMIT_KEY_DELAY_MS = 150;

let win;
let term;
let reader;
let tts;
let replyId = 0;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    backgroundColor: "#0a0f1c",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

function startTerminal(cwd) {
  const shell = os.platform() === "win32"
    ? "powershell.exe"
    : (process.env.SHELL || "/bin/zsh");
  term = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 100,
    rows: 30,
    cwd: cwd || os.homedir(),
    env: { ...process.env, ASSISTANT_CONSOLE_SESSION_FILE: sessionPointerFile },
  });

  term.onData((data) => {
    win?.webContents.send("term:data", data);
  });

  term.onExit(() => win?.webContents.send("term:exit"));
}

app.whenReady().then(() => {
  createWindow();
  startTerminal();

  // When a new assistant message lands in the session transcript,
  // synthesize sentence-by-sentence + stream audio chunks to the renderer.
  tts = new TtsEngine({
    onChunk: (header, wav) => {
      win?.webContents.send("voice:audio-chunk", {
        id: header.id,
        seq: header.seq,
        last: header.last,
        wav: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
      });
    },
    onError: (msg) => win?.webContents.send("voice:error", msg),
  });
  tts.start();

  reader = new TranscriptReader(sessionPointerFile, (text) => {
    const speakable = toSpeakable(text);
    if (!speakable) return;
    tts.speak(++replyId, speakable);
  });
  reader.start();

  ipcMain.on("voice:cancel", () => {
    tts?.cancel(replyId);
    win?.webContents.send("voice:cancelled", replyId);
  });

  // terminal I/O
  ipcMain.on("term:input", (_e, data) => term?.write(data));
  ipcMain.on("term:resize", (_e, { cols, rows }) => term?.resize(cols, rows));
  ipcMain.on("term:send-line", (_e, text) => {
    if (!term) return;
    term.write(text);
    setTimeout(() => term?.write("\r"), SUBMIT_KEY_DELAY_MS);
  });

  // voice control — listening no longer auto-enables reading; the Read toggle does.
  ipcMain.on("voice:listening", (_e, _on) => { /* mic state is renderer-side */ });

  // reading toggle — when off, the reader is disabled so nothing is spoken.
  ipcMain.on("voice:reading", (_e, on) => {
    if (on) reader?.enable(); else reader?.disable();
  });

  // STT: renderer sends a captured utterance (WAV), we return the transcript.
  ipcMain.handle("voice:transcribe", async (_e, arrayBuffer) => {
    const buf = Buffer.from(arrayBuffer);
    return await transcribe(buf);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  term?.kill();
  reader?.stop();
  tts?.stop();
  try { require("node:fs").unlinkSync(sessionPointerFile); } catch {}
  if (process.platform !== "darwin") app.quit();
});