// Browser client. Captures mic, runs Silero VAD (hands-free — no key press),
// streams each detected utterance to the server as WAV, receives text + audio.

const ws = new WebSocket(`ws://${location.host}`);
ws.binaryType = "arraybuffer";

const el = {
  status: document.getElementById("status"),
  messages: document.getElementById("messages"),
  micToggle: document.getElementById("mic-toggle"),
  sessionList: document.getElementById("session-list"),
  newSession: document.getElementById("new-session"),
  textForm: document.getElementById("text-form"),
  textInput: document.getElementById("text-input"),
  providerSelect: document.getElementById("provider-select"),
};

let vad = null;
let listening = false;
let activeSessionId = null;
let liveAssistantEl = null; // element we stream assistant deltas into

// --- WebSocket messages from server ---------------------------------------
ws.addEventListener("message", async (ev) => {
  if (ev.data instanceof ArrayBuffer) {
    // Binary = TTS audio to play.
    playAudio(ev.data);
    return;
  }
  const msg = JSON.parse(ev.data);
  switch (msg.type) {
    case "sessions":
      renderSessions(msg.sessions, msg.active);
      if (msg.active) activeSessionId = msg.active;
      break;
    case "providers":
      renderProviders(msg.providers, msg.default);
      break;
    case "active":
      activeSessionId = msg.active;
      highlightActive();
      break;
    case "status":
      setStatus(msg.state);
      break;
    case "user":
      addMessage("user", msg.text);
      break;
    case "assistant_delta":
      appendAssistantDelta(msg.text);
      break;
    case "assistant":
      finalizeAssistant(msg.text);
      break;
    case "error":
      addMessage("error", msg.message);
      break;
  }
});

// --- VAD + mic -------------------------------------------------------------
el.micToggle.addEventListener("click", async () => {
  if (listening) {
    stopListening();
  } else {
    await startListening();
  }
});

async function startListening() {
  if (!vad) {
    // vad-web: onSpeechEnd gives Float32Array of the utterance at 16kHz mono.
    vad = await window.vad.MicVAD.new({
      onSpeechStart: () => setStatus("listening"),
      onSpeechEnd: (audio) => {
        const wav = encodeWav(audio, 16000);
        if (ws.readyState === WebSocket.OPEN) ws.send(wav);
      },
    });
  }
  vad.start();
  listening = true;
  el.micToggle.textContent = "Stop listening";
  el.micToggle.classList.add("active");
  setStatus("idle");
}

function stopListening() {
  vad?.pause();
  listening = false;
  el.micToggle.textContent = "Start listening";
  el.micToggle.classList.remove("active");
  setStatus("idle");
}

// --- typed input fallback --------------------------------------------------
el.textForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el.textInput.value.trim();
  if (!text) return;
  addMessage("user", text);
  ws.send(JSON.stringify({ type: "text", text }));
  el.textInput.value = "";
});

// --- sessions --------------------------------------------------------------
el.newSession.addEventListener("click", () => {
  const name = prompt("Session name?") || "session";
  ws.send(JSON.stringify({ type: "new", name }));
});

function renderSessions(sessions, active) {
  el.sessionList.innerHTML = "";
  for (const s of sessions) {
    const li = document.createElement("li");
    li.textContent = s.name;
    li.dataset.id = s.id;
    if (s.id === active) li.classList.add("active");
    li.addEventListener("click", () => {
      ws.send(JSON.stringify({ type: "switch", sessionId: s.id }));
    });
    el.sessionList.appendChild(li);
  }
}
function highlightActive() {
  [...el.sessionList.children].forEach((li) =>
    li.classList.toggle("active", li.dataset.id === activeSessionId)
  );
}

// --- providers -------------------------------------------------------------
function renderProviders(providers, def) {
  el.providerSelect.innerHTML = "";
  for (const p of providers) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.id}${p.kind === "agentic" ? " ⚙" : ""}`;
    if (p.id === def) opt.selected = true;
    el.providerSelect.appendChild(opt);
  }
}
el.providerSelect?.addEventListener("change", () => {
  ws.send(JSON.stringify({ type: "set_provider", providerId: el.providerSelect.value }));
});

// --- transcript UI ---------------------------------------------------------
function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  el.messages.appendChild(div);
  el.messages.scrollTop = el.messages.scrollHeight;
  return div;
}
function appendAssistantDelta(text) {
  if (!liveAssistantEl) liveAssistantEl = addMessage("assistant", "");
  liveAssistantEl.textContent += text;
  el.messages.scrollTop = el.messages.scrollHeight;
}
function finalizeAssistant(text) {
  if (liveAssistantEl) liveAssistantEl.textContent = text;
  else addMessage("assistant", text);
  liveAssistantEl = null;
}

function setStatus(state) {
  el.status.textContent = state;
  el.status.className = `status ${state}`;
}

// --- audio playback --------------------------------------------------------
let audioCtx;
async function playAudio(arrayBuffer) {
  audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
  const buf = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start();
}

// --- WAV encoding (Float32 mono -> 16-bit PCM WAV) -------------------------
function encodeWav(float32, sampleRate) {
  const buffer = new ArrayBuffer(44 + float32.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + float32.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, float32.length * 2, true);
  let off = 44;
  for (let i = 0; i < float32.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
