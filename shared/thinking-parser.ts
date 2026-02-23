/**
 * Parser for extracting <thinking> blocks from AI responses.
 *
 * The AI is instructed to wrap its reasoning in <thinking>...</thinking> tags.
 * This parser separates the thinking content from the actual output.
 */

export interface ParsedThinking {
  /** The AI's reasoning content, or null if no thinking block found */
  thinking: string | null;
  /** The actual output with thinking block stripped */
  output: string;
}

/**
 * Extract thinking content from an AI response.
 * Handles responses with or without thinking blocks gracefully.
 */
export function parseThinking(rawResponse: string): ParsedThinking {
  if (!rawResponse) return { thinking: null, output: "" };

  const match = rawResponse.match(/<thinking>([\s\S]*?)<\/thinking>/);
  if (!match) {
    return { thinking: null, output: rawResponse };
  }

  const thinking = match[1].trim();
  const output = rawResponse.replace(/<thinking>[\s\S]*?<\/thinking>/, "").trim();
  return { thinking, output };
}

/**
 * Check if a partial (streaming) response has a complete thinking block.
 * Returns true if the response contains both opening and closing thinking tags.
 */
export function hasCompleteThinking(partial: string): boolean {
  return /<thinking>[\s\S]*?<\/thinking>/.test(partial);
}

/**
 * Extract thinking from a partial stream — returns thinking if complete,
 * or null if still streaming inside the thinking block.
 * Also returns whether we're currently inside a thinking block.
 */
export function parseStreamingThinking(partial: string): {
  thinking: string | null;
  visibleContent: string;
  isInsideThinking: boolean;
} {
  // Check if thinking block is complete
  const completeMatch = partial.match(/<thinking>([\s\S]*?)<\/thinking>/);
  if (completeMatch) {
    const thinking = completeMatch[1].trim();
    const visibleContent = partial.replace(/<thinking>[\s\S]*?<\/thinking>/, "").trim();
    return { thinking, visibleContent, isInsideThinking: false };
  }

  // Check if we're inside an incomplete thinking block
  const openMatch = partial.match(/<thinking>([\s\S]*)$/);
  if (openMatch) {
    // Still streaming thinking — hide the thinking content from visible output
    const beforeThinking = partial.slice(0, partial.indexOf("<thinking>")).trim();
    return { thinking: null, visibleContent: beforeThinking, isInsideThinking: true };
  }

  // No thinking tags at all
  return { thinking: null, visibleContent: partial, isInsideThinking: false };
}
