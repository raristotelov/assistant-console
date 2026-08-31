// Preload: safe bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  sessions: {
    create: () => ipcRenderer.invoke("session:create"),
    setFolder: (id) => ipcRenderer.invoke("session:set-folder", id),
    close: (id) => ipcRenderer.send("session:close", id),
    onStats: (cb) => ipcRenderer.on("session:stats", (_e, payload) => cb(payload)),
    onStatus: (cb) => ipcRenderer.on("session:status", (_e, payload) => cb(payload)),
    onAnswer: (cb) => ipcRenderer.on("session:answer", (_e, payload) => cb(payload)),
  },

  editor: {
    open: (id) => ipcRenderer.invoke("editor:open", id),
    close: (id) => ipcRenderer.invoke("editor:close", id),
  },

  term: {
    open: (id) => ipcRenderer.invoke("term:open", id),
    close: (id) => ipcRenderer.invoke("term:close", id),
    input: (id, data) => ipcRenderer.send("term:input", { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send("term:resize", { id, cols, rows }),
    sendLine: (id, text) => ipcRenderer.send("term:send-line", { id, text }),
    onData: (cb) => ipcRenderer.on("term:data", (_e, payload) => cb(payload)),
    onExit: (cb) => ipcRenderer.on("term:exit", (_e, payload) => cb(payload)),
  },

  voice: {
    setReading: (id, on) => ipcRenderer.send("voice:reading", { id, on }),
    transcribe: (arrayBuffer) => ipcRenderer.invoke("voice:transcribe", arrayBuffer),
    onAudioChunk: (cb) => ipcRenderer.on("voice:audio-chunk", (_e, chunk) => cb(chunk)),
    cancelSpeech: () => ipcRenderer.send("voice:cancel"),
    onCancelled: (cb) => ipcRenderer.on("voice:cancelled", (_e, id) => cb(id)),
    onStatus: (cb) => ipcRenderer.on("voice:status", (_e, text) => cb(text)),
  },
});
