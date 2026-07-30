// The research-assist prompts now live in shared/ (SPEC-M5 FR-1.5/FR-3.4) so
// the Electron main process's refine-text equivalent uses the exact same
// prompt text this Deno function does — see shared/ai/prompts/research.ts.
// Re-exported here so existing importers (research-query/index.ts) keep
// working unchanged.
export {
  NORMAL_SYSTEM_PROMPT,
  STRICT_INSTRUCTION_ON,
  STRICT_INSTRUCTION_OFF,
  SPELLING_SYSTEM_PROMPT,
  CITATIONS_SYSTEM_PROMPT,
  CITATIONS_CONSTRAINED_PROMPT,
  COMBINED_SYSTEM_PROMPT,
  pickPromptKey,
} from "../../../shared/ai/prompts/research.ts";
export type { ResearchAssistMode } from "../../../shared/ai/prompts/research.ts";
