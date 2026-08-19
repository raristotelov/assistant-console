const fs = require("node:fs");

const POLL_MS = 300;

class TranscriptReader {
  constructor(pointerFile, onReply) {
    this.pointerFile = pointerFile;
    this.onReply = onReply;
    this.enabled = false;
    this.transcriptPath = null;
    this.offset = 0;
    this.carry = "";
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  enable() {
    this.fastForwardToLiveEnd();
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  fastForwardToLiveEnd() {
    this.refreshTranscriptPath();
    if (!this.transcriptPath) return;
    try {
      this.offset = fs.statSync(this.transcriptPath).size;
      this.carry = "";
    } catch {}
  }

  refreshTranscriptPath() {
    let pointed;
    try {
      pointed = fs.readFileSync(this.pointerFile, "utf8").trim();
    } catch {
      return;
    }
    if (!pointed || pointed === this.transcriptPath) return;
    this.transcriptPath = pointed;
    this.carry = "";
    try {
      this.offset = fs.statSync(pointed).size;
    } catch {
      this.offset = 0;
    }
  }

  poll() {
    this.refreshTranscriptPath();
    if (!this.transcriptPath) return;

    let size;
    try {
      size = fs.statSync(this.transcriptPath).size;
    } catch {
      return;
    }
    if (size <= this.offset) return;

    let appended;
    try {
      const fd = fs.openSync(this.transcriptPath, "r");
      try {
        const buf = Buffer.alloc(size - this.offset);
        fs.readSync(fd, buf, 0, buf.length, this.offset);
        appended = buf.toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return;
    }
    this.offset = size;

    const lines = (this.carry + appended).split("\n");
    this.carry = lines.pop();
    for (const line of lines) this.handleLine(line);
  }

  handleLine(line) {
    if (!this.enabled) return;
    const trimmed = line.trim();
    if (!trimmed) return;

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (entry.type !== "assistant" || entry.isSidechain) return;

    const content = entry.message?.content;
    if (!Array.isArray(content)) return;

    const text = content
      .filter((block) => block && block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join(" ")
      .trim();
    if (text) this.onReply(text);
  }
}

module.exports = { TranscriptReader };
