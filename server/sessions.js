// Session manager. Each session wraps one conversation with a chosen provider.
// Sessions are first-class objects so multi-session (a sidebar, "switch to X"
// by voice) is just exposing more of what already exists. Provider-agnostic:
// the session calls provider.send(), not any specific AI SDK.

import { randomUUID } from "node:crypto";

export class Session {
  constructor({ name, cwd, provider }) {
    this.id = randomUUID();
    this.name = name || "session";
    this.cwd = cwd || process.cwd();
    this.provider = provider;      // a Provider instance
    this.history = [];             // {role, text, ts}
    this.busy = false;
    // Provider-specific per-session state (e.g. Claude Code's resume id) lives
    // here so providers stay stateless and sessions carry the thread.
    this.ctx = { cwd: this.cwd };
  }

  /**
   * Send a user turn to this session's provider and stream the reply back.
   * @param {string} text
   * @param {(chunk: string) => void} onChunk
   * @returns {Promise<string>}
   */
  async send(text, onChunk) {
    this.busy = true;
    this.history.push({ role: "user", text, ts: Date.now() });
    let full = "";
    try {
      full = await this.provider.send(text, this.history, onChunk, this.ctx);
    } finally {
      this.busy = false;
    }
    this.history.push({ role: "assistant", text: full, ts: Date.now() });
    return full;
  }

  setProvider(provider) {
    this.provider = provider;
    // Reset provider-specific thread state but keep visible history.
    this.ctx = { cwd: this.cwd };
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      busy: this.busy,
      provider: this.provider?.id,
      kind: this.provider?.kind,
    };
  }
}

export class SessionManager {
  constructor(registry, defaultProviderId) {
    this.registry = registry;
    this.defaultProviderId = defaultProviderId;
    this.sessions = new Map();
  }

  create({ name, cwd, providerId } = {}) {
    const provider =
      this.registry.get(providerId) || this.registry.get(this.defaultProviderId);
    if (!provider) throw new Error("No provider available");
    const s = new Session({ name, cwd, provider });
    this.sessions.set(s.id, s);
    return s;
  }

  get(id) {
    return this.sessions.get(id);
  }

  list() {
    return [...this.sessions.values()].map((s) => s.toJSON());
  }

  remove(id) {
    return this.sessions.delete(id);
  }
}
