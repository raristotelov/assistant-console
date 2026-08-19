// Provider config — the ONE place to add or switch AI backends.
// Set DEFAULT_PROVIDER to whichever id you want new sessions to use.
// Secrets come from env vars so they never live in the repo.

import { ClaudeCodeProvider } from "./providers/claudeCode.js";
import { OpenAICompatProvider } from "./providers/openaiCompat.js";
import { ProviderRegistry } from "./providers/base.js";

export const DEFAULT_PROVIDER = process.env.VOICE_PROVIDER || "claude-code";

export function buildRegistry() {
  const registry = new ProviderRegistry();

  // Agentic: Claude Code (files, commands, MCP). Uses your Claude Code auth.
  registry.register(new ClaudeCodeProvider({ id: "claude-code" }));

  // Chat: OpenAI / ChatGPT. Needs OPENAI_API_KEY.
  if (process.env.OPENAI_API_KEY) {
    registry.register(
      new OpenAICompatProvider({
        id: "openai",
        baseURL: "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || "gpt-4o",
      })
    );
  }

  // Chat: local via Ollama (no key). Run `ollama serve` + pull a model.
  registry.register(
    new OpenAICompatProvider({
      id: "ollama",
      baseURL: process.env.OLLAMA_URL || "http://localhost:11434/v1",
      apiKey: "ollama",
      model: process.env.OLLAMA_MODEL || "llama3.1",
    })
  );

  // Chat: local via LM Studio (any key). Start its local server first.
  registry.register(
    new OpenAICompatProvider({
      id: "lmstudio",
      baseURL: process.env.LMSTUDIO_URL || "http://localhost:1234/v1",
      apiKey: "lmstudio",
      model: process.env.LMSTUDIO_MODEL || "local-model",
    })
  );

  // Add more here — OpenRouter, Groq, etc. all use OpenAICompatProvider:
  // registry.register(new OpenAICompatProvider({
  //   id: "openrouter",
  //   baseURL: "https://openrouter.ai/api/v1",
  //   apiKey: process.env.OPENROUTER_API_KEY,
  //   model: "anthropic/claude-3.5-sonnet",
  // }));

  return registry;
}
