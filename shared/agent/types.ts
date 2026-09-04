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

/**
 * The governance mode for one agent run (M9 ADR-0026):
 * - `ask`  — read-only. No tool that changes a file is available.
 * - `plan` — the agent produces its full step list and stops before the first
 *            write, waiting for the scholar to approve it.
 * - `auto` — the agent runs every step; writes land as tracked changes.
 *
 * (Replaces M8's `'ask' | 'do'`; an old `'do'` maps to `'auto'`.)
 */
export type AgentMode = 'ask' | 'plan' | 'auto';

/** One message in the running conversation the loop maintains. */
export type AgentMessage =
  | { role: 'user'; text: string }
  | { role: 'model'; text?: string; toolCall?: { name: string; args: Record<string, unknown> } }
  | { role: 'tool'; name: string; result: unknown };

/**
 * What a model call returns: a final answer, a tool call to run, or — when the
 * ask is ambiguous — one short clarifying question (M9 ADR-0027 F6).
 */
export type ModelStep =
  | { kind: 'text'; text: string }
  | { kind: 'toolCall'; name: string; args: Record<string, unknown> }
  | { kind: 'clarify'; question: string };

/** Injected into the loop — the real one calls Gemini; tests pass a fake. */
export type ModelFn = (messages: AgentMessage[], tools: AgentTool[], systemPrompt: string) => Promise<ModelStep>;

/** Injected into the loop — runs one tool call and returns its result. */
export type DispatchFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * A live view of something the agent is producing — a chapter draft, a
 * comparison table, a running citation list (M9 ADR-0024). Emitted on the same
 * `AGENT_PROGRESS` channel as a step line, under `kind: 'artifact'`.
 */
export type AgentArtifactType =
  | 'document' | 'table' | 'citation-list' | 'outline' | 'index'
  | 'comparison' | 'transcript' | 'plan';

export type AgentArtifactEvent =
  | { op: 'open'; artifactId: string; title: string; artifactType: AgentArtifactType }
  | { op: 'delta'; artifactId: string; mode: 'append' | 'replace'; html?: string; text?: string; anchor?: string }
  | { op: 'table'; artifactId: string; columns: string[]; rows: string[][]; caption?: string }
  | {
      op: 'citations';
      artifactId: string;
      entries: Array<{ marker: string; reference: string; sourceId: string; supported?: boolean; url?: string; tier?: 1 | 2 | 3 | 4 }>;
    }
  | { op: 'close'; artifactId: string; status: 'final' | 'aborted'; targetChapter?: string };

/** Emits one artifact event — injected into the dispatcher (M9 ADR-0024). */
export type EmitArtifactFn = (ev: AgentArtifactEvent) => void;

/** Progress event emitted per step — the Agent chat renders these live. */
export interface AgentProgress {
  step?: number;
  /** A short present-tense phrase: "reading the file", "searching Shamela". */
  label?: string;
  kind:
    | 'thinking' | 'tool' | 'tool-result' | 'done' | 'error'
    | 'clarify' | 'artifact' | 'plan-pending'
    | 'general-search-request' | 'transcribe-request' | 'ocr-request';
  detail?: string;
  /** `kind: 'artifact'` — the artifact event. */
  artifact?: AgentArtifactEvent;
  /** `kind: 'clarify'` — the question the agent needs answered. */
  question?: string;
  /** `kind: 'general-search-request'` — the renderer-bridged search (ADR-0019 #7). */
  requestId?: string;
  query?: string;
  mode?: 'general' | 'islamic';
  /** `kind: 'transcribe-request'` — the renderer-bridged Whisper run (M9 Phase 5). */
  mediaPath?: string;
  lang?: string;
  /** `kind: 'ocr-request'` — the consent-gated renderer→cloud OCR run (M9 Phase 7, ADR-0023). */
  scanPath?: string;
  pages?: string;
}

export interface AgentRunResult {
  answer: string;
  messages: AgentMessage[];
  /** Every tool call made, for the Trust-tab transcript. */
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
  steps: number;
  stopReason: 'done' | 'step-limit' | 'cancelled' | 'error' | 'needs-input';
  /** `stopReason: 'needs-input'` — the clarifying question to surface. */
  question?: string;
  error?: string;
}

/** Waits for the scholar to approve a proposed plan (Plan mode, M9 ADR-0026). */
export type WaitForApprovalFn = (plan: { steps: string[]; summary: string }) => Promise<'approved' | 'rejected'>;

export interface AgentRunOptions {
  mode: AgentMode;
  /** Hard cap on model turns — a runaway loop stops here. */
  maxSteps?: number;
  onProgress?: (p: AgentProgress) => void;
  /** Resolves true to stop the loop between steps. */
  isCancelled?: () => boolean;
  /** Plan mode — resolves once the scholar approves (or rejects) the plan. */
  waitForApproval?: WaitForApprovalFn;
}
