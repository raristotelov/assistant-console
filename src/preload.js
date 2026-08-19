// Preload: safe bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("term", {
  input: (data) => ipcRenderer.send("term:input", data),
  resize: (size) => ipcRenderer.send("term:resize", size),
  sendLine: (text) => ipcRenderer.send("term:send-line", text),
  onData: (cb) => ipcRenderer.on("term:data", (_e, data) => cb(data)),
  onExit: (cb) => ipcRenderer.on("term:exit", () => cb()),
});

contextBridge.exposeInMainWorld("voice", {
  setListening: (on) => ipcRenderer.send("voice:listening", on),
  setReading: (on) => ipcRenderer.send("voice:reading", on),
  transcribe: (arrayBuffer) => ipcRenderer.invoke("voice:transcribe", arrayBuffer),
  onAudioChunk: (cb) => ipcRenderer.on("voice:audio-chunk", (_e, chunk) => cb(chunk)),
  cancelSpeech: () => ipcRenderer.send("voice:cancel"),
  onCancelled: (cb) => ipcRenderer.on("voice:cancelled", (_e, id) => cb(id)),
  onError: (cb) => ipcRenderer.on("voice:error", (_e, msg) => cb(msg)),
});
