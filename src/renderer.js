// Renderer: draws the xterm terminal, relays keystrokes to the pty, provides a
// send box, and wires the VOICE loop:
//   mic -> Silero VAD -> whisper (main) -> type into terminal
//   transcript reply (main) -> kokoro (main) -> queued audio chunks play here

const xterm = new Terminal({
  fontFamily: "Menlo, Monaco, monospace",
  fontSize: 13,
  theme: { background: "#0a0f1c", foreground: "#e5e7eb" },
  cursorBlink: true,
});
const fit = new FitAddon.FitAddon();
xterm.loadAddon(fit);
xterm.open(document.getElementById("terminal"));
fit.fit();

// pty output -> screen
window.term.onData((data) => xterm.write(data));
window.term.onExit(() => xterm.write("\r\n[process exited]\r\n"));
// typed keystrokes -> pty
xterm.onData((data) => window.term.input(data));

function syncSize() {
  fit.fit();
  window.term.resize({ cols: xterm.cols, rows: xterm.rows });
}
window.addEventListener("resize", syncSize);
setTimeout(syncSize, 100);

// --- send box --------------------------------------------------------------
const line = document.getElementById("line");
const send = document.getElementById("send");
function sendLine() {
  const text = line.value.trim();
  if (!text) return;
  window.term.sendLine(text);
  line.value = "";
  xterm.focus();
}
send.addEventListener("click", sendLine);
line.addEventListener("keydown", (e) => { if (e.key === "Enter") sendLine(); });

// --- status ----------------------------------------------------------------
const statusEl = document.getElementById("status");
function setStatus(s) { statusEl.textContent = s; }

// --- voice: play spoken reply chunks from main, in order --------------------
let audioCtx;
let currentSource = null; // so we can interrupt
let playQueue = [];
let playing = false;
let lastSeenReplyId = 0;
let lastCancelledReplyId = 0;

window.voice.onAudioChunk((chunk) => {
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
    xterm.write(`\r\n[audio error: ${e.message || e}]\r\n`);
    playNext();
  }
}

function stopSpeaking() {
  lastCancelledReplyId = lastSeenReplyId;
  window.voice.cancelSpeech();
  playQueue = [];
  if (currentSource) { try { currentSource.stop(); } catch {} currentSource = null; }
}

window.voice.onCancelled((id) => {
  if (id > lastCancelledReplyId) lastCancelledReplyId = id;
  playQueue = playQueue.filter((c) => c.id > lastCancelledReplyId);
});
window.voice.onError((msg) => xterm.write(`\r\n[voice error: ${msg}]\r\n`));

// --- read toggle: only speak replies when reading is ON --------------------
const readBtn = document.getElementById("read");
let reading = false;
readBtn.addEventListener("click", () => {
  reading = !reading;
  window.voice.setReading(reading);
  readBtn.textContent = `Reading: ${reading ? "on" : "off"}`;
  readBtn.classList.toggle("active", reading);
});

// --- stop speaking: interrupt current playback -----------------------------
const stopBtn = document.getElementById("stop-speak");
stopBtn.addEventListener("click", stopSpeaking);

// --- voice: mic + VAD ------------------------------------------------------
const mic = document.getElementById("mic");
let vad = null;
let listening = false;

mic.addEventListener("click", async () => {
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
          const text = await window.voice.transcribe(wav);
          if (text) {
            // Barge-in: real words confirmed, so stop the assistant talking.
            stopSpeaking();
            window.term.sendLine(text); // type the spoken words into the terminal
            setStatus("thinking");
          } else {
            setStatus("listening");
          }
        } catch (e) {
          xterm.write(`\r\n[stt error: ${e.message || e}]\r\n`);
          setStatus("listening");
        }
      },
    });
  }
  vad.start();
  listening = true;
  mic.textContent = "Stop listening";
  mic.classList.add("active");
  setStatus("listening");
}

function stopListening() {
  vad?.pause();
  listening = false;
  mic.textContent = "Start listening";
  mic.classList.remove("active");
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
