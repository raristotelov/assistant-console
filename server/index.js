// voice-claude server: serves the browser client and runs the voice<->Claude loop.
//
// Flow per turn:
//   browser (VAD-gated mic) --audio--> server
//   server: whisper transcribe -> Claude Code session -> stream text back
//   server: Piper synthesize -> audio back to browser
//
// The browser does mic capture + VAD; the server does STT, Claude, and TTS.

import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { SessionManager } from "./sessions.js";
import { transcribe, synthesize } from "./speech.js";
import { buildRegistry, DEFAULT_PROVIDER } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4141;

const app = express();
app.use(express.static(join(__dirname, "..", "public")));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const registry = buildRegistry();
const manager = new SessionManager(registry, DEFAULT_PROVIDER);
// One default session to start. Multi-session UI can create more later.
const defaultSession = manager.create({ name: "main", cwd: process.cwd() });

wss.on("connection", (ws) => {
  send(ws, { type: "sessions", sessions: manager.list(), active: defaultSession.id });
  send(ws, { type: "providers", providers: registry.list(), default: DEFAULT_PROVIDER });

  // Track which session this socket is talking to (defaults to the first one).
  ws.activeSessionId = defaultSession.id;

  ws.on("message", async (data, isBinary) => {
    if (isBinary) {
      // Binary frame = a completed utterance (WAV) the browser's VAD captured.
      await handleUtterance(ws, Buffer.from(data));
      return;
    }
    // Text frame = a control message (JSON).
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    await handleControl(ws, msg);
  });
});

async function handleControl(ws, msg) {
  switch (msg.type) {
    case "switch": // { type:'switch', sessionId }
      if (manager.get(msg.sessionId)) ws.activeSessionId = msg.sessionId;
      send(ws, { type: "active", active: ws.activeSessionId });
      break;
    case "new": // { type:'new', name, cwd, providerId }
      {
        const s = manager.create({ name: msg.name, cwd: msg.cwd, providerId: msg.providerId });
        ws.activeSessionId = s.id;
        broadcast({ type: "sessions", sessions: manager.list() });
        send(ws, { type: "active", active: s.id });
      }
      break;
    case "set_provider": // { type:'set_provider', providerId } — change active session's provider
      {
        const s = manager.get(ws.activeSessionId);
        const provider = registry.get(msg.providerId);
        if (s && provider) {
          s.setProvider(provider);
          broadcast({ type: "sessions", sessions: manager.list() });
        }
      }
      break;
    case "text": // { type:'text', text } — typed input, bypasses STT
      await runTurn(ws, msg.text);
      break;
  }
}

async function handleUtterance(ws, wavBuffer) {
  try {
    send(ws, { type: "status", state: "transcribing" });
    const text = await transcribe(wavBuffer);
    if (!text) {
      send(ws, { type: "status", state: "idle" });
      return;
    }
    send(ws, { type: "user", text }); // show what it heard
    await runTurn(ws, text);
  } catch (e) {
    send(ws, { type: "error", message: String(e.message || e) });
    send(ws, { type: "status", state: "idle" });
  }
}

async function runTurn(ws, text) {
  const session = manager.get(ws.activeSessionId);
  if (!session) return;

  send(ws, { type: "status", state: "thinking" });

  // Stream Claude's text to the browser as it arrives (for the transcript view).
  const reply = await session.send(text, (chunk) => {
    send(ws, { type: "assistant_delta", text: chunk });
  });

  send(ws, { type: "assistant", text: reply });

  // Speak the reply.
  try {
    send(ws, { type: "status", state: "speaking" });
    const wav = await synthesize(reply);
    ws.send(wav, { binary: true }); // binary reply = audio to play
  } catch (e) {
    send(ws, { type: "error", message: `TTS failed: ${e.message || e}` });
  }
  send(ws, { type: "status", state: "idle" });
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(s);
}

httpServer.listen(PORT, () => {
  console.log(`voice-claude on http://localhost:${PORT}`);
  console.log(`from your phone (via Tailscale): http://<laptop-tailscale-ip>:${PORT}`);
});
