// OpenAI-compatible provider — chat only. One adapter covers a huge range of
// backends because they all speak the OpenAI chat-completions API:
//   - OpenAI / ChatGPT   base: https://api.openai.com/v1        (needs API key)
//   - Ollama (local)     base: http://localhost:11434/v1        (key: "ollama")
//   - LM Studio (local)  base: http://localhost:1234/v1         (any key)
//   - OpenRouter, Groq…  their base URL + key
//
// Configure via { id, baseURL, apiKey, model }. This is "chat" kind — it talks,
// it doesn't touch your machine. Streams tokens via SSE.

export class OpenAICompatProvider {
  constructor({ id, baseURL, apiKey, model, system }) {
    this.id = id;
    this.kind = "chat";
    this.baseURL = baseURL.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.system = system || "You are a helpful voice assistant. Keep replies concise and speakable.";
  }

  async send(text, history = [], onChunk) {
    const messages = [
      { role: "system", content: this.system },
      ...history.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.text,
      })),
      { role: "user", content: text },
    ];

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, messages, stream: true }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${this.id} HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    // Parse the SSE stream of chat.completion.chunk objects.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep the incomplete tail

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) {
            full += delta;
            onChunk?.(delta);
          }
        } catch {
          // ignore keep-alive / partial lines
        }
      }
    }
    return full;
  }
}
