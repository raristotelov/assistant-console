// Claude Code provider — agentic. Runs Claude Code via the Agent SDK, so it can
// read/write files, run commands, and use your MCP servers. Keeps a per-session
// thread id (ctx.claudeSessionId) to resume the conversation across turns.

import { query } from "@anthropic-ai/claude-agent-sdk";

export class ClaudeCodeProvider {
  constructor({ id = "claude-code" } = {}) {
    this.id = id;
    this.kind = "agentic";
  }

  // history is unused here — Claude Code maintains its own thread via resume.
  async send(text, _history, onChunk, ctx = {}) {
    let full = "";
    const stream = query({
      prompt: text,
      options: {
        cwd: ctx.cwd,
        resume: ctx.claudeSessionId ?? undefined,
      },
    });

    for await (const msg of stream) {
      if (msg?.session_id && ctx) ctx.claudeSessionId = msg.session_id;
      const chunk = extractText(msg);
      if (chunk) {
        full += chunk;
        onChunk?.(chunk);
      }
    }
    return full;
  }
}

function extractText(msg) {
  if (!msg) return "";
  if (typeof msg === "string") return msg;
  if (msg.type === "assistant" && msg.message?.content) {
    return msg.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  if (msg.type === "text" && msg.text) return msg.text;
  if (msg.delta?.text) return msg.delta.text;
  return "";
}
