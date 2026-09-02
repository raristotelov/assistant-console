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
const closeEditorBtn = document.getElementById("close-editor");
const closeTermBtn = document.getElementById("close-term");
const changeFolderBtn = document.getElementById("change-folder");
const changeFolderTip = document.getElementById("change-folder-tip");

const sessions = new Map();
const sessionOrder = [];
let activeId = null;

const DRAG_THRESHOLD_PX = 4;
const DRAG_EDGE_PX = 36;
const DRAG_SCROLL_PX = 10;
let justDragged = false;
let rowDragActive = false;

function setStatus(s) {
  statusEl.textContent = s;
}

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
    id,
    folder,
    pane,
    editorSlot,
    termSlot,
    editorAdd,
    termAdd,
    term: null,
    fit: null,
    editorUrl: null,
    stats: null,
    reading: false,
    exited: false,
    status: "idle",
    unread: false,
    speaking: false,
  };
  sessions.set(id, session);
  sessionOrder.push(id);
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
  button.appendChild(glyph(GLYPHS.plus, "glyph-md"));
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
    theme: { background: token("--bg"), foreground: token("--text") },
    cursorBlink: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(session.termSlot);
  term.onData((data) => window.api.term.input(session.id, data));

  session.term = term;
  session.fit = fit;
  if (session.reading) window.api.voice.setReading(session.id, true);
  syncChrome();
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
    view.setAttribute("allowpopups", "");
    session.editorAdd.wrap.remove();
    session.editorSlot.classList.add("filled");
    session.editorSlot.appendChild(view);
    session.editorUrl = url;
    syncChrome();
    fitActive();
  } catch (e) {
    session.editorAdd.button.disabled = false;
    session.editorAdd.caption.textContent = "VS Code";
    setStatus(`code-server failed: ${e.message || e}`);
  }
}

function resetSlot(slot, add, label) {
  slot.textContent = "";
  slot.classList.remove("filled");
  add.button.disabled = false;
  add.caption.textContent = label;
  slot.appendChild(add.wrap);
}

async function closeEditorPane(session) {
  if (!session.editorUrl) return;
  await window.api.editor.close(session.id);
  session.editorUrl = null;
  resetSlot(session.editorSlot, session.editorAdd, "VS Code");
  syncChrome();
  fitActive();
}

async function closeTerminalPane(session) {
  if (!session.term) return;
  await window.api.term.close(session.id);
  session.term.dispose();
  Object.assign(session, {
    term: null,
    fit: null,
    exited: false,
    stats: null,
    status: "idle",
    unread: false,
  });
  resetSlot(session.termSlot, session.termAdd, "Terminal for Claude Code");
  renderSidebar();
  syncChrome();
}

async function changeFolder() {
  const session = sessions.get(activeId);
  if (!canChangeFolder(session)) return;

  const changed = await window.api.sessions.setFolder(session.id);
  if (!changed) return;

  session.folder = changed.folder;
  renderSidebar();
  syncChrome();
}

function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  window.api.sessions.close(id);
  session.term?.dispose();
  session.pane.remove();
  sessions.delete(id);
  const at = sessionOrder.indexOf(id);
  if (at >= 0) sessionOrder.splice(at, 1);

  if (activeId === id) {
    activeId = null;
    if (sessionOrder.length) activate(sessionOrder[0]);
  }
  renderSidebar();
  syncChrome();
}

function activate(id) {
  const session = sessions.get(id);
  if (!session) return;
  activeId = id;
  session.unread = false;
  for (const other of sessions.values()) other.pane.classList.toggle("active", other.id === id);
  renderSidebar();
  syncChrome();
  fitActive();
  resyncViewport(session.term);
  session.term?.focus();
}

function resyncViewport(term) {
  if (!term || term.rows < 2) return;
  const { cols, rows } = term;
  term.resize(cols, rows - 1);
  term.resize(cols, rows);
}

const ICON_PATHS = {
  mic: {
    on: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
    off: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18",
  },
  speaker: {
    on: "M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12",
    off: "M4 9v6h4l5 4V5L8 9H4zM3 3l18 18",
  },
};

const GLYPHS = {
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  chevronLeft: "M11 6l-6 6 6 6M18 6l-6 6 6 6",
  chevronRight: "M13 6l6 6-6 6M6 6l6 6-6 6",
};

function glyph(d, className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.classList.add(className);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

function makeIcon(name, state, title, onClick) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.classList.add("session-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICON_PATHS[name][state === "off" ? "off" : "on"]);
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  const wrap = document.createElement(onClick ? "button" : "span");
  wrap.className = `session-icon-slot ${name} ${state}`;
  wrap.title = title;
  wrap.appendChild(svg);
  if (onClick) {
    wrap.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  return wrap;
}

function toggleReading(session) {
  session.reading = !session.reading;
  window.api.voice.setReading(session.id, session.reading);
  syncChrome();
  renderSidebar();
}

const flyoutEl = document.createElement("div");
flyoutEl.className = "session-flyout";
flyoutEl.hidden = true;
document.body.appendChild(flyoutEl);

function showFlyout(item, text) {
  if (rowDragActive || !sidebarEl.classList.contains("collapsed")) return;
  const rect = item.getBoundingClientRect();
  flyoutEl.textContent = text;
  flyoutEl.style.top = `${rect.top + rect.height / 2}px`;
  flyoutEl.style.left = `${rect.right + 8}px`;
  flyoutEl.hidden = false;
}

function hideFlyout() {
  flyoutEl.hidden = true;
}

sessionListEl.addEventListener("scroll", hideFlyout);

function rowStep(rows) {
  if (rows.length > 1) return rows[1].offsetTop - rows[0].offsetTop;
  return rows[0] ? rows[0].offsetHeight : 0;
}

function beginRowDrag(item, event) {
  const rows = [...sessionListEl.children];
  const from = rows.indexOf(item);
  const step = rowStep(rows);
  if (from < 0 || !step) return;

  const startY = event.clientY;
  const startScroll = sessionListEl.scrollTop;
  let pointerY = startY;
  let target = from;
  let dragging = false;
  let frame = null;

  const place = () => {
    const dy = pointerY - startY + (sessionListEl.scrollTop - startScroll);
    target = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / step)));
    item.style.transform = `translateY(${dy}px)`;
    for (const [i, row] of rows.entries()) {
      if (row === item) continue;
      let shift = 0;
      if (target > from && i > from && i <= target) shift = -step;
      if (target < from && i >= target && i < from) shift = step;
      row.style.transform = shift ? `translateY(${shift}px)` : "";
    }
  };

  const autoscroll = () => {
    const rect = sessionListEl.getBoundingClientRect();
    let delta = 0;
    if (pointerY < rect.top + DRAG_EDGE_PX) delta = -DRAG_SCROLL_PX;
    else if (pointerY > rect.bottom - DRAG_EDGE_PX) delta = DRAG_SCROLL_PX;
    if (delta) {
      const before = sessionListEl.scrollTop;
      sessionListEl.scrollTop += delta;
      if (sessionListEl.scrollTop !== before) place();
    }
    frame = requestAnimationFrame(autoscroll);
  };

  const onMove = (e) => {
    pointerY = e.clientY;
    if (!dragging) {
      if (Math.abs(pointerY - startY) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      rowDragActive = true;
      hideFlyout();
      item.classList.add("dragging");
      sessionListEl.classList.add("reordering");
      frame = requestAnimationFrame(autoscroll);
    }
    place();
  };

  const finish = (e) => {
    item.releasePointerCapture(e.pointerId);
    item.removeEventListener("pointermove", onMove);
    if (frame) cancelAnimationFrame(frame);
    if (!dragging) return;

    justDragged = true;
    setTimeout(() => {
      justDragged = false;
    }, 0);

    const reordered = moveSession(sessionOrder, from, target > from ? target + 1 : target);
    sessionOrder.splice(0, sessionOrder.length, ...reordered);
    sessionListEl.classList.remove("reordering");
    rowDragActive = false;
    renderSidebar();
  };

  item.setPointerCapture(event.pointerId);
  item.addEventListener("pointermove", onMove);
  item.addEventListener("pointerup", finish, { once: true });
  item.addEventListener("pointercancel", finish, { once: true });
}

function renderSidebar() {
  if (rowDragActive) return;
  sessionListEl.textContent = "";
  for (const id of sessionOrder) {
    const session = sessions.get(id);
    if (!session) continue;

    const item = document.createElement("div");
    item.className = `session-item ${sessionStatus(session)}`;
    item.classList.toggle("active", session.id === activeId);
    item.title = session.folder;
    item.addEventListener("click", () => {
      if (justDragged) return;
      activate(session.id);
    });
    item.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      beginRowDrag(item, e);
    });
    item.addEventListener("pointerenter", () => showFlyout(item, sessionName(session)));
    item.addEventListener("pointerleave", hideFlyout);

    const dot = document.createElement("span");
    dot.className = "dot";

    const monogram = document.createElement("span");
    monogram.className = "monogram";
    monogram.textContent = sessionMonogram(session);

    const name = document.createElement("span");
    name.className = "session-name";
    name.textContent = sessionName(session);

    const icons = document.createElement("span");
    icons.className = "session-icons";
    icons.append(
      makeIcon("mic", micState(session, listening, activeId), "Voice input"),
      makeIcon(
        "speaker",
        speakerState(session),
        session.reading ? "Stop reading this session" : "Read this session aloud",
        () => toggleReading(session),
      ),
    );

    const close = document.createElement("button");
    close.className = "session-close";
    close.appendChild(glyph(GLYPHS.close, "glyph-sm"));
    close.title = "Close session";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSession(session.id);
    });

    item.append(dot, monogram, name, icons, close);
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

  closeEditorBtn.disabled = !session?.editorUrl;
  closeTermBtn.disabled = !session?.term;

  const folderChangeable = canChangeFolder(session);
  changeFolderBtn.disabled = !folderChangeable;
  changeFolderTip.title = folderChangeable
    ? "Change this session's folder"
    : "Close VS Code and the terminal first — the folder can only change while both panes are closed";

  renderStats(session?.stats);
}

function renderStats(stats) {
  const set = (id, value) => {
    document.getElementById(id).textContent = value;
  };
  if (!stats) {
    for (const id of [
      "stat-context",
      "stat-in",
      "stat-out",
      "stat-cache-read",
      "stat-cache-write",
      "stat-messages",
    ])
      set(id, "—");
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

window.api.sessions.onStatus(({ id, status }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.status = status;
  renderSidebar();
});

window.api.sessions.onAnswer(({ id }) => {
  const session = sessions.get(id);
  if (!session) return;
  if (id !== activeId) session.unread = true;
  renderSidebar();
});

closeEditorBtn.addEventListener("click", () => {
  const session = sessions.get(activeId);
  if (session) closeEditorPane(session);
});
closeTermBtn.addEventListener("click", () => {
  const session = sessions.get(activeId);
  if (session) closeTerminalPane(session);
});
changeFolderBtn.addEventListener("click", changeFolder);

document.getElementById("new-session").addEventListener("click", createSession);
document.getElementById("start-btn").addEventListener("click", createSession);
document.getElementById("collapse").addEventListener("click", () => {
  const collapsed = sidebarEl.classList.toggle("collapsed");
  hideFlyout();
  document
    .getElementById("collapse-path")
    .setAttribute("d", collapsed ? GLYPHS.chevronRight : GLYPHS.chevronLeft);
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

function setSpeaking(id) {
  let changed = false;
  for (const session of sessions.values()) {
    const next = session.id === id;
    if (session.speaking !== next) {
      session.speaking = next;
      changed = true;
    }
  }
  if (changed) renderSidebar();
}

async function playNext() {
  const chunk = playQueue.shift();
  if (!chunk) {
    playing = false;
    setSpeaking(null);
    return;
  }
  if (chunk.id <= lastCancelledReplyId) {
    playNext();
    return;
  }
  playing = true;
  setSpeaking(chunk.sessionId);
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
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {}
    currentSource = null;
  }
  setSpeaking(null);
}

window.api.voice.onStatus((text) => setStatus(text || (listening ? "listening" : "terminal")));

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
  toggleReading(session);
});

document.getElementById("stop-speak").addEventListener("click", stopSpeaking);

// --- voice: mic + VAD, always typed into the ACTIVE session ----------------
let vad = null;
let listening = false;

micBtn.addEventListener("click", async () => {
  if (listening) stopListening();
  else await startListening();
});

async function startListening() {
  if (!vad) {
    vad = await window.vad.MicVAD.new({
      baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.19/dist/",
      onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/",
      onSpeechStart: () => {
        showHeard("");
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
  renderSidebar();
}

function stopListening() {
  vad?.pause();
  listening = false;
  micBtn.textContent = "Start listening";
  micBtn.classList.remove("active");
  setStatus("terminal");
  renderSidebar();
}

// --- WAV encoding (Float32 mono -> 16-bit PCM WAV) -> ArrayBuffer -----------
function encodeWav(float32, sampleRate) {
  const buffer = new ArrayBuffer(44 + float32.length * 2);
  const view = new DataView(buffer);
  const w = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  view.setUint32(4, 36 + float32.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, float32.length * 2, true);
  let off = 44;
  for (let i = 0; i < float32.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

syncChrome();
