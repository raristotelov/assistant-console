const fs = require("node:fs");

const POLL_MS = 300;

const emptyStats = () => ({
  model: null,
  cwd: null,
  gitBranch: null,
  contextTokens: 0,
  messages: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
});

function isLocalCommandOutput(entry) {
  const content = entry.message?.content;
  return typeof content === "string" && content.includes("<local-command-stdout>");
}

class TranscriptReader {
  constructor(pointerFile, { onReply, onStats, onStatus, onAnswer } = {}) {
    this.pointerFile = pointerFile;
    this.onReply = onReply || (() => {});
    this.onStats = onStats || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onAnswer = onAnswer || (() => {});
    this.status = "idle";
    this.enabled = false;
    this.transcriptPath = null;
    this.offset = 0;
    this.speakFrom = Infinity;
    this.carry = "";
    this.timer = null;
    this.stats = emptyStats();
    this.statsChanged = false;
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
    this.refreshTranscriptPath();
    this.speakFrom = this.fileSize();
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  fileSize() {
    try {
      return fs.statSync(this.transcriptPath).size;
    } catch {
      return 0;
    }
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
    this.offset = 0;
    this.carry = "";
    this.stats = emptyStats();
    this.statsChanged = true;
    this.speakFrom = this.enabled ? this.fileSize() : Infinity;
    this.setStatus("idle");
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
    if (size > this.offset) {
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

      const carried = this.carry;
      let cursor = this.offset - Buffer.byteLength(carried);
      this.offset = size;

      const lines = (carried + appended).split("\n");
      this.carry = lines.pop();
      for (const line of lines) {
        const lineEnd = cursor + Buffer.byteLength(line);
        this.handleLine(line, lineEnd);
        cursor = lineEnd + 1;
      }
    }

    if (this.statsChanged) {
      this.statsChanged = false;
      this.onStats({ ...this.stats });
    }
  }

  handleLine(line, lineEnd) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (entry.type === "user") {
      if (entry.isSidechain) return;
      if (isLocalCommandOutput(entry)) {
        this.setStatus("idle");
        this.onAnswer();
        return;
      }
      this.setStatus("working");
      return;
    }
    if (entry.type !== "assistant") return;

    const message = entry.message || {};
    this.applyUsage(entry, message);
    if (entry.isSidechain) return;

    const content = message.content;
    if (!Array.isArray(content)) return;

    const text = content
      .filter((block) => block && block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join(" ")
      .trim();
    if (!text) return;

    const narratingBeforeToolCall = message.stop_reason === "tool_use";
    if (!narratingBeforeToolCall) {
      this.setStatus("idle");
      this.onAnswer();
    }

    if (!this.enabled || lineEnd <= this.speakFrom) return;
    this.onReply(text);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  applyUsage(entry, message) {
    const usage = message.usage;
    if (!usage) return;

    const input = usage.input_tokens || 0;
    const output = usage.output_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheCreation = usage.cache_creation_input_tokens || 0;

    this.stats.inputTokens += input;
    this.stats.outputTokens += output;
    this.stats.cacheReadTokens += cacheRead;
    this.stats.cacheCreationTokens += cacheCreation;

    if (!entry.isSidechain) {
      this.stats.messages += 1;
      this.stats.contextTokens = input + cacheRead + cacheCreation + output;
      this.stats.model = message.model || this.stats.model;
      this.stats.cwd = entry.cwd || this.stats.cwd;
      this.stats.gitBranch = entry.gitBranch || this.stats.gitBranch;
    }
    this.statsChanged = true;
  }
}

module.exports = { TranscriptReader };
