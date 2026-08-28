// Renderer: sidebar of sessions, one xterm per session, and the VOICE loop:
//   mic -> Silero VAD -> whisper (main) -> typed into the ACTIVE session
//   transcript reply (main) -> kokoro (main) -> queued audio chunks play here
// Reading is per session, so a background session can still be read aloud.

const sidebarEl = document.getElementById("sidebar");
const sessionListEl = document.getElementById("session-list");
const panesEl = document.getElementById("panes");
const toolbarEl = document.getElementById("toolbar");
const startEl = document.getElementById("start");
const footerEl = document.querySelector("footer");
const statusEl = document.getElementById("status");
const readBtn = document.getElementById("read");
const micBtn = document.getElementById("mic");
const heardEl = document.getElementById("heard");

const sessions = new Map();
let activeId = null;

function setStatus(s) { statusEl.textContent = s; }

function formatTokens(n) {
  if (!n) return "0";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

async function createSession() {
  const created = await window.api.sessions.create();
  if (!created) return;
  const { id, folder } = created;

  const pane = document.createElement("div");
  pane.className = "session-pane";

  const editorSlot = document.createElement("div");
  editorSlot.className = "editor-slot";
  const editorAdd = makeSlotAdd("VS Code");
  editorSlot.appendChild(editorAdd.wrap);

  const termSlot = document.createElement("div");
  termSlot.className = "term-slot";
  const termAdd = makeSlotAdd("Terminal for Claude Code");
  termSlot.appendChild(termAdd.wrap);

  pane.append(editorSlot, termSlot);
  panesEl.appendChild(pane);

  const session = {
    id, folder, pane, editorSlot, termSlot, editorAdd, termAdd,
    term: null, fit: null, editorUrl: null, stats: null, reading: false, exited: false,
  };
  sessions.set(id, session);
  pane.insertBefore(makeDivider(session), termSlot);

  editorAdd.button.addEventListener("click", () => addEditor(session));
  termAdd.button.addEventListener("click", () => addTerminal(session));

  renderSidebar();
  activate(id);
}

function makeDivider(session) {
  const divider = document.createElement("div");
  divider.className = "divider";
  divider.title = "Drag to resize";

  const onMove = (e) => {
    const rect = session.pane.getBoundingClientRect();
    const pct = ((e.clientY - rect.top) / rect.height) * 100;
    session.editorSlot.style.flex = `0 0 ${Math.min(85, Math.max(15, pct))}%`;
    fitActive();
  };

  const onUp = (e) => {
    divider.releasePointerCapture(e.pointerId);
    divider.removeEventListener("pointermove", onMove);
    session.pane.classList.remove("resizing");
    fitActive();
  };

  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    session.pane.classList.add("resizing");
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp, { once: true });
  });

  return divider;
}

function makeSlotAdd(label) {
  const wrap = document.createElement("div");
  wrap.className = "slot-add";
  const button = document.createElement("button");
  button.textContent = "+";
  button.title = `Add ${label}`;
  const caption = document.createElement("span");
  caption.textContent = label;
  wrap.append(button, caption);
  return { wrap, button, caption };
}

async function addTerminal(session) {
  if (session.term) return;
  session.termAdd.button.disabled = true;
  await window.api.term.open(session.id);

  session.termAdd.wrap.remove();
  session.termSlot.classList.add("filled");

  const term = new Terminal({
    fontFamily: "Menlo, Monaco, monospace",
    fontSize: 13,
    theme: { background: "#0a0f1c", foreground: "#e5e7eb" },
    cursorBlink: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(session.termSlot);
  term.onData((data) => window.api.term.input(session.id, data));

  session.term = term;
  session.fit = fit;
  fitActive();
  term.focus();
}

async function addEditor(session) {
  if (session.editorUrl) return;
  session.editorAdd.button.disabled = true;
  session.editorAdd.caption.textContent = "Starting VS Code…";
  try {
    const { url } = await window.api.editor.open(session.id);
    const view = document.createElement("webview");
    view.setAttribute("src", url);
    session.editorAdd.wrap.remove();
    session.editorSlot.classList.add("filled");
    session.editorSlot.appendChild(view);
    session.editorUrl = url;
    fitActive();
  } catch (e) {
    session.editorAdd.button.disabled = false;
    session.editorAdd.caption.textContent = "VS Code";
    setStatus(`code-server failed: ${e.message || e}`);
  }
}

function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  window.api.sessions.close(id);
  session.term?.dispose();
  session.pane.remove();
  sessions.delete(id);

  if (activeId === id) {
    activeId = null;
    const next = sessions.keys().next();
    if (!next.done) activate(next.value);
  }
  renderSidebar();
  syncChrome();
}

function activate(id) {
  const session = sessions.get(id);
  if (!session) return;
  activeId = id;
  for (const other of sessions.values()) other.pane.classList.toggle("active", other.id === id);
  renderSidebar();
  syncChrome();
  fitActive();
  session.term?.focus();
}

function sessionName(session) {
  const parts = session.folder.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : `Session ${session.id}`;
}

function renderSidebar() {
  sessionListEl.textContent = "";
  for (const session of sessions.values()) {
    const item = document.createElement("div");
    item.className = "session-item";
    item.classList.toggle("active", session.id === activeId);
    item.classList.toggle("reading", session.reading);
    item.classList.toggle("exited", session.exited);
    item.title = session.folder;
    item.addEventListener("click", () => activate(session.id));

    const dot = document.createElement("span");
    dot.className = "dot";

    const name = document.createElement("span");
    name.className = "session-name";
    name.textContent = sessionName(session);

    const close = document.createElement("button");
    close.className = "session-close";
    close.textContent = "×";
    close.title = "Close session";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSession(session.id);
    });

    item.append(dot, name, close);
    sessionListEl.appendChild(item);
  }
}

function syncChrome() {
  const hasSessions = sessions.size > 0;
  startEl.classList.toggle("hidden", hasSessions);
  panesEl.classList.toggle("hidden", !hasSessions);
  toolbarEl.classList.toggle("hidden", !hasSessions);
  footerEl.classList.toggle("hidden", !hasSessions);

  const session = sessions.get(activeId);
  readBtn.textContent = session?.reading ? "Stop reading" : "Start reading";
  readBtn.classList.toggle("active", !!session?.reading);
  renderStats(session?.stats);
}

function renderStats(stats) {
  const set = (id, value) => { document.getElementById(id).textContent = value; };
  if (!stats) {
    for (const id of ["stat-context", "stat-in", "stat-out", "stat-cache-read", "stat-cache-write", "stat-messages"]) set(id, "—");
    set("stat-model", "—");
    return;
  }
  set("stat-context", formatTokens(stats.contextTokens));
  set("stat-in", formatTokens(stats.inputTokens));
  set("stat-out", formatTokens(stats.outputTokens));
  set("stat-cache-read", formatTokens(stats.cacheReadTokens));
  set("stat-cache-write", formatTokens(stats.cacheCreationTokens));
  set("stat-messages", String(stats.messages));
  set("stat-model", stats.model || "—");
}

function fitActive() {
  const session = sessions.get(activeId);
  if (!session?.fit) return;
  session.fit.fit();
  window.api.term.resize(session.id, session.term.cols, session.term.rows);
}

window.api.term.onData(({ id, data }) => sessions.get(id)?.term?.write(data));
window.api.term.onExit(({ id }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.exited = true;
  session.term?.write("\r\n[process exited]\r\n");
  renderSidebar();
});

window.api.sessions.onStats(({ id, stats }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.stats = stats;
  renderSidebar();
  if (id === activeId) renderStats(stats);
});

document.getElementById("new-session").addEventListener("click", createSession);
document.getElementById("start-btn").addEventListener("click", createSession);
document.getElementById("collapse").addEventListener("click", () => {
  const collapsed = sidebarEl.classList.toggle("collapsed");
  document.getElementById("collapse").textContent = collapsed ? "»" : "«";
  setTimeout(fitActive, 160);
});

window.addEventListener("resize", fitActive);

function showHeard(text) {
  heardEl.textContent = text;
  heardEl.classList.toggle("filled", !!text);
}

// --- voice: play spoken reply chunks from main, in order --------------------
let audioCtx;
let currentSource = null;
let playQueue = [];
let playing = false;
let lastSeenReplyId = 0;
let lastCancelledReplyId = 0;

window.api.voice.onAudioChunk((chunk) => {
  if (chunk.id > lastSeenReplyId) lastSeenReplyId = chunk.id;
  if (chunk.id <= lastCancelledReplyId) return;
  playQueue.push(chunk);
  if (!playing) playNext();
});

async function playNext() {
  const chunk = playQueue.shift();
  if (!chunk) { playing = false; return; }
  if (chunk.id <= lastCancelledReplyId) { playNext(); return; }
  playing = true;
  audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
  try {
    const decoded = await audioCtx.decodeAudioData(chunk.wav.slice(0));
    const src = audioCtx.createBufferSource();
    src.buffer = decoded;
    src.connect(audioCtx.destination);
    src.onended = () => {
      if (currentSource === src) currentSource = null;
      playNext();
    };
    currentSource = src;
    src.start();
  } catch (e) {
    writeToActive(`\r\n[audio error: ${e.message || e}]\r\n`);
    playNext();
  }
}

function stopSpeaking() {
  lastCancelledReplyId = lastSeenReplyId;
  window.api.voice.cancelSpeech();
  playQueue = [];
  if (currentSource) { try { currentSource.stop(); } catch {} currentSource = null; }
}

window.api.voice.onCancelled((id) => {
  if (id > lastCancelledReplyId) lastCancelledReplyId = id;
  playQueue = playQueue.filter((c) => c.id > lastCancelledReplyId);
});

function writeToActive(text) {
  sessions.get(activeId)?.term?.write(text);
}

// --- read toggle: per session ---------------------------------------------
readBtn.addEventListener("click", () => {
  const session = sessions.get(activeId);
  if (!session) return;
  session.reading = !session.reading;
  window.api.voice.setReading(session.id, session.reading);
  syncChrome();
  renderSidebar();
});

document.getElementById("stop-speak").addEventListener("click", stopSpeaking);

// --- voice: mic + VAD, always typed into the ACTIVE session ----------------
let vad = null;
let listening = false;

micBtn.addEventListener("click", async () => {
  if (listening) stopListening(); else await startListening();
});

async function startListening() {
  if (!vad) {
    vad = await window.vad.MicVAD.new({
      baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.19/dist/",
      onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/",
      onSpeechStart: () => {
        setStatus("listening");
      },
      onSpeechEnd: async (audio) => {
        setStatus("transcribing");
        const wav = encodeWav(audio, 16000);
        try {
          const text = await window.api.voice.transcribe(wav);
          const session = sessions.get(activeId);
          if (text && session?.term) {
            // Barge-in: real words confirmed, so stop the assistant talking.
            stopSpeaking();
            showHeard(text);
            window.api.term.sendLine(session.id, text);
            setStatus("thinking");
          } else {
            setStatus("listening");
          }
        } catch (e) {
          writeToActive(`\r\n[stt error: ${e.message || e}]\r\n`);
          setStatus("listening");
        }
      },
    });
  }
  vad.start();
  listening = true;
  micBtn.textContent = "Stop listening";
  micBtn.classList.add("active");
  setStatus("listening");
}

function stopListening() {
  vad?.pause();
  listening = false;
  micBtn.textContent = "Start listening";
  micBtn.classList.remove("active");
  setStatus("terminal");
}

// --- WAV encoding (Float32 mono -> 16-bit PCM WAV) -> ArrayBuffer -----------
function encodeWav(float32, sampleRate) {
  const buffer = new ArrayBuffer(44 + float32.length * 2);
  const view = new DataView(buffer);
  const w = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  w(0, "RIFF"); view.setUint32(4, 36 + float32.length * 2, true); w(8, "WAVE");
  w(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); w(36, "data"); view.setUint32(40, float32.length * 2, true);
  let off = 44;
  for (let i = 0; i < float32.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

syncChrome();
