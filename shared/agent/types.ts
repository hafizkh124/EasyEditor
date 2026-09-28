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
 * What a model call returns: a final answer, a tool call to run, one short
 * clarifying question (M9 ADR-0027 F6), or — Ask mode only, M11 — a request
 * to switch to Plan/Auto because the task needs a write Ask doesn't have.
 */
export type ModelStep =
  | { kind: 'text'; text: string }
  | { kind: 'toolCall'; name: string; args: Record<string, unknown> }
  | { kind: 'clarify'; question: string }
  | { kind: 'modeUpgrade'; targetMode: 'plan' | 'auto'; reason: string };

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
  | 'comparison' | 'transcript' | 'plan'
  // ADR-0045 — JKHSSN visualisations (rendered by the artifact stage in Phase 5).
  | 'sanad-tree' | 'matn-diff' | 'narrator-card';

export type AgentArtifactEvent =
  | { op: 'open'; artifactId: string; title: string; artifactType: AgentArtifactType }
  | { op: 'delta'; artifactId: string; mode: 'append' | 'replace'; html?: string; text?: string; anchor?: string }
  | { op: 'table'; artifactId: string; columns: string[]; rows: string[][]; caption?: string }
  /** Structured payload for a visualisation artifact (sanad-tree nodes, etc.). */
  | { op: 'data'; artifactId: string; payload: unknown }
  | {
      op: 'citations';
      artifactId: string;
      entries: Array<{
        marker: string;
        reference: string;
        sourceId: string;
        supported?: boolean;
        url?: string;
        tier?: 1 | 2 | 3 | 4;
        /** The retrieved source passage — shown on expand so the scholar can read it before accepting the tracked change. */
        excerpt?: string;
        /** The claim this citation was inserted to support, when one was given. */
        claim?: string;
        /** A hadith grading AS THE SOURCE STATED IT (الدرر السنية, ADR-0040) — a distinct chip, never our verdict. */
        grade?: string;
      }>;
    }
  | { op: 'close'; artifactId: string; status: 'final' | 'aborted'; targetChapter?: string };

/** Emits one artifact event — injected into the dispatcher (M9 ADR-0024). */
export type EmitArtifactFn = (ev: AgentArtifactEvent) => void;

/** Progress event emitted per step — the Agent chat renders these live. */
export interface AgentProgress {
  step?: number;
  /** A short present-tense phrase: "reading the file", "searching Shamela". */
  label?: string;
  /**
   * M11 Phase 2 — the i18n key for `label` (`agent.step.<tool>`). `shared/`
   * can't translate; the renderer does `t(labelKey, label)`, so `label` stays
   * the English fallback for any key not in the locale.
   */
  labelKey?: string;
  kind:
    | 'thinking' | 'tool' | 'tool-result' | 'done' | 'error'
    | 'clarify' | 'artifact' | 'plan-pending' | 'file-approval-pending'
    | 'general-search-request' | 'transcribe-request' | 'ocr-request'
    // Plan §4.6 — one sticky determinate row for a batch (per-book/per-author) run.
    | 'batch-item';
  detail?: string;
  /** `kind: 'batch-item'` — the batch's total item count (for the progress bar). */
  total?: number;
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
  /** `kind: 'file-approval-pending'` — M13 (ADR-0056) per-write approval of an outside-project file. */
  fileApproval?: { requestId: string; path: string; ops: string[]; backup?: string; tool: string };
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
  /**
   * `stopReason: 'needs-input'` — Ask mode asked (via `request_mode_upgrade`,
   * or the loop's own defensive block when the model attempts a write tool
   * it wasn't given) to switch to Plan/Auto. The UI offers an approve/decline
   * card; approving re-sends the same instruction under `targetMode` (M11).
   */
  modeUpgrade?: { targetMode: 'plan' | 'auto'; reason: string };
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
  /**
   * M11 Phase 1 — prior conversation turns, prepended to the run's messages so
   * a follow-up question has the thread. Built by `shared/agent/history.ts`
   * (`user` / plain-text `model` messages only — never tool traffic; see that
   * file). Empty / absent = a cold run, exactly as before.
   */
  history?: AgentMessage[];
}
