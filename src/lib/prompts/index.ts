export { NORMAL_SYSTEM_PROMPT, STRICT_INSTRUCTION_ON, STRICT_INSTRUCTION_OFF } from "./normal";
export { SPELLING_SYSTEM_PROMPT } from "./spelling";
export { CITATIONS_SYSTEM_PROMPT } from "./citations";
export { COMBINED_SYSTEM_PROMPT } from "./combined";

export type ResearchAssistMode = "spelling" | "citations";

/**
 * Pick the correct system prompt body given the active assist modes.
 * Normal prompt still needs {{STRICT_INSTRUCTION}} and {{CONTEXT_BLOCK}} substituted by the caller.
 */
export function pickPromptKey(modes: ResearchAssistMode[]): "normal" | "spelling" | "citations" | "combined" {
  const hasSpelling = modes.includes("spelling");
  const hasCitations = modes.includes("citations");
  if (hasSpelling && hasCitations) return "combined";
  if (hasSpelling) return "spelling";
  if (hasCitations) return "citations";
  return "normal";
}
