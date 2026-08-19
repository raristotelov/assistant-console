// Provider contract. Every AI backend implements this so the rest of the app
// never knows which one it's talking to. Swapping providers is a config choice.
//
// A provider is either:
//   - "agentic": can act on your machine (files, commands, tools) — e.g. Claude Code
//   - "chat":    conversation only — e.g. ChatGPT, or a local model via Ollama
//
// The voice loop is identical for both; only agentic providers can *do* things.

/**
 * @typedef {Object} Provider
 * @property {string} id
 * @property {"agentic"|"chat"} kind
 * @property {(text: string, history: Array<{role,text}>, onChunk: (s:string)=>void, ctx: object) => Promise<string>} send
 */

// Simple registry so providers can be looked up by id from config.
export class ProviderRegistry {
  constructor() {
    this.providers = new Map();
  }
  register(provider) {
    this.providers.set(provider.id, provider);
    return provider;
  }
  get(id) {
    return this.providers.get(id);
  }
  list() {
    return [...this.providers.values()].map((p) => ({ id: p.id, kind: p.kind }));
  }
}
