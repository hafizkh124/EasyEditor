/**
 * M8 Layer 6 — agent types (SPEC-M8 §3, ADR-0016).
 *
 * Pure: shared/ is imported by the Electron main process (the agent runs
 * there) and the renderer (the Agent tab). No runtime globals.
 *
 * The agent's vocabulary is CLOSED (ADR-0016 control 1): it selects tool
 * calls from a fixed registry, it never writes free-form prose into the
 * model's loop "as the task". `AgentTool` is that registry's entry shape.
 */

/** A parameter of a tool, in a shape that maps 1:1 to a Gemini function-declaration. */
export interface ToolParam {
  type: 'string' | 'number' | 'boolean' | 'array';
  description: string;
  /** For `type: 'array'` — the item type. */
  items?: { type: 'string' | 'number' };
  enum?: string[];
}

export interface AgentTool {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  required: string[];
  /**
   * `read` tools never touch a file; `write` tools produce a tracked change or
   * write into the project folder. "Ask" mode exposes only `read` tools.
   */
  effect: 'read' | 'write';
}

/** One message in the running conversation the loop maintains. */
export type AgentMessage =
  | { role: 'user'; text: string }
  | { role: 'model'; text?: string; toolCall?: { name: string; args: Record<string, unknown> } }
  | { role: 'tool'; name: string; result: unknown };

/** What a model call returns: either a final answer, or a tool call to run. */
export type ModelStep =
  | { kind: 'text'; text: string }
  | { kind: 'toolCall'; name: string; args: Record<string, unknown> };

/** Injected into the loop — the real one calls Gemini; tests pass a fake. */
export type ModelFn = (messages: AgentMessage[], tools: AgentTool[], systemPrompt: string) => Promise<ModelStep>;

/** Injected into the loop — runs one tool call and returns its result. */
export type DispatchFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/** Progress event emitted per step — the Agent chat renders these live. */
export interface AgentProgress {
  step: number;
  /** A short present-tense phrase: "reading the file", "searching Shamela". */
  label: string;
  kind: 'thinking' | 'tool' | 'tool-result' | 'done' | 'error';
  detail?: string;
}

export interface AgentRunResult {
  answer: string;
  messages: AgentMessage[];
  /** Every tool call made, for the Trust-tab transcript. */
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
  steps: number;
  stopReason: 'done' | 'step-limit' | 'cancelled' | 'error';
  error?: string;
}

export interface AgentRunOptions {
  mode: 'ask' | 'do';
  /** Hard cap on model turns — a runaway loop stops here. */
  maxSteps?: number;
  onProgress?: (p: AgentProgress) => void;
  /** Resolves true to stop the loop between steps. */
  isCancelled?: () => boolean;
}
