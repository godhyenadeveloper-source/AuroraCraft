/**
 * Reusable server-side AI calling function.
 * Extracted from /api/ai/generate in routes.ts for use by the build runner.
 * Non-streaming — collects the full response before returning.
 */

import OpenAI from "openai";
import { storage } from "./storage";

export interface CallAIServerOptions {
  modelId: number;
  systemPrompt: string;
  messages: { role: string; content: string }[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CallAIServerResult {
  text: string;
  inputChars: number;
  outputChars: number;
  finishReason?: string;
}

export async function callAIServer(opts: CallAIServerOptions): Promise<CallAIServerResult> {
  const { modelId, systemPrompt, messages, maxTokens, signal } = opts;

  const model = await storage.getModel(modelId);
  if (!model || !model.providerId) {
    throw new Error("Model not found");
  }

  const provider = await storage.getProvider(model.providerId);
  if (!provider) {
    throw new Error("Provider not found");
  }
  if (!provider.apiKey) {
    throw new Error(`API key not configured for ${provider.name}`);
  }

  const chatMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const inputChars = chatMessages.reduce((sum, m) => sum + m.content.length, 0);
  let outputText = "";
  let finishReason = "";

  // Handle Google Gemini API
  if (provider.name.toLowerCase() === "google") {
    const modelName = model.name.includes("/") ? model.name.split("/").pop() : model.name;
    const url = `${provider.baseUrl}models/${modelName}:generateContent?key=${provider.apiKey}`;

    const contents = chatMessages.slice(1).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens || 4096 },
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    outputText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    finishReason = data.candidates?.[0]?.finishReason || "stop";
  }
  // Handle Bytez-style API
  else if (provider.authType === "api_key" || provider.name.toLowerCase() === "bytez") {
    const url = `${provider.baseUrl}${model.name}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: provider.apiKey,
      },
      body: JSON.stringify({
        messages: chatMessages,
        max_tokens: maxTokens || 4096,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    outputText = data.choices?.[0]?.message?.content || data.output || data.response || "";
    finishReason = data.choices?.[0]?.finish_reason || "stop";
  }
  // OpenAI-compatible providers (non-streaming)
  else {
    const openai = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl,
    });

    const response = await openai.chat.completions.create({
      model: model.name,
      messages: chatMessages,
      max_completion_tokens: maxTokens || 4096,
    });

    outputText = response.choices[0]?.message?.content || "";
    finishReason = response.choices[0]?.finish_reason || "stop";
  }

  return {
    text: outputText,
    inputChars,
    outputChars: outputText.length,
    finishReason,
  };
}
