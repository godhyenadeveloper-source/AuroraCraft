/**
 * Unified AI client that normalizes Puter.js (client-side) and server-side
 * AI providers into a single async function.
 *
 * Does NOT save messages, does NOT deduct tokens — the caller handles that.
 */

export interface AIGenerateOptions {
  model: {
    id: number;
    name: string;
    providerAuthType?: string | null;
  };
  systemPrompt: string;
  messages: { role: string; content: string }[];
  sessionId: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}

export interface AIGenerateResult {
  text: string;
  inputChars: number;
  outputChars: number;
  finishReason?: string;
}

/**
 * Generate an AI response using either Puter.js or the server-side proxy.
 * Returns the complete response text.
 */
export async function generateAI(options: AIGenerateOptions): Promise<AIGenerateResult> {
  const { model, signal } = options;
  const isPuter = model.providerAuthType === "puterjs";

  if (isPuter) {
    return generateWithPuter(options);
  }
  return generateWithServer(options);
}

async function generateWithPuter(options: AIGenerateOptions): Promise<AIGenerateResult> {
  const { model, systemPrompt, messages, signal, onChunk } = options;
  const anyWindow = window as any;
  const puter = anyWindow?.puter;

  if (!puter?.ai?.chat) {
    throw new Error("Puter.js is not available. Make sure the Puter.js script is loaded.");
  }

  const chatMessages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const inputChars = chatMessages.reduce((sum, m) => sum + m.content.length, 0);

  const stream = await puter.ai.chat(chatMessages, false, {
    stream: true,
    model: model.name,
  });

  let fullText = "";
  for await (const part of stream as any) {
    if (signal?.aborted) break;
    const text = part?.text || "";
    if (!text) continue;
    fullText += text;
    onChunk?.(text);
  }

  return {
    text: fullText,
    inputChars,
    outputChars: fullText.length,
  };
}

async function generateWithServer(options: AIGenerateOptions): Promise<AIGenerateResult> {
  const { model, systemPrompt, messages, sessionId, maxTokens, signal, onChunk } = options;

  const response = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: model.id,
      systemPrompt,
      messages,
      sessionId,
      maxTokens: maxTokens || 4096,
    }),
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    // Parse error into a clean, user-friendly message
    let cleanMessage = "AI generation failed";
    try {
      const errorJson = JSON.parse(errorText);
      cleanMessage = errorJson.message || errorJson.error || cleanMessage;
    } catch {
      const firstLine = errorText.split("\n")[0].replace(/<[^>]*>/g, "").trim();
      if (firstLine.length > 0 && firstLine.length < 200) {
        cleanMessage = firstLine;
      }
    }
    if (response.status === 401 || response.status === 403) {
      cleanMessage = "Authentication failed. Please check your API key.";
    } else if (response.status === 429) {
      cleanMessage = "Rate limit exceeded. Please try again in a moment.";
    } else if (response.status === 404) {
      cleanMessage = "Model not found. It may have been renamed or removed.";
    }
    throw new Error(cleanMessage);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No reader available on response");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let inputChars = 0;
  let outputChars = 0;
  let finishReason: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "chunk") {
          fullText += data.content;
          onChunk?.(data.content);
        } else if (data.type === "done") {
          inputChars = data.inputChars || 0;
          outputChars = data.outputChars || 0;
          finishReason = data.finishReason;
        } else if (data.type === "error") {
          throw new Error(data.content || "AI streaming error");
        }
      } catch (e: any) {
        if (e.message?.includes("AI streaming error") || e.message?.includes("AI generation failed")) {
          throw e;
        }
        // Ignore JSON parse errors from partial chunks
      }
    }
  }

  return {
    text: fullText,
    inputChars: inputChars || systemPrompt.length + messages.reduce((s, m) => s + m.content.length, 0),
    outputChars: outputChars || fullText.length,
    finishReason,
  };
}
