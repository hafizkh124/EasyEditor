/**
 * M8 Layer 6 — the agentic loop (SPEC-M8 §3, ADR-0016).
 *
 * Pure and injectable: the loop takes a `ModelFn` (the real one calls Gemini
 * with function-calling; tests pass a scripted fake) and a `DispatchFn` (runs
 * one tool call against the real adapters). It maintains the conversation,
 * enforces a hard step limit, emits a progress event per step, and stops on a
 * final text answer, the step limit, cancellation, an error, a clarifying
 * question (M9 ADR-0027 F6), or a rejected plan (M9 ADR-0026 Plan mode).
 *
 * ADR-0016 control 1: the loop never fabricates "the task" as free-form
 * prose — the model can only return a tool call from the closed registry, a
 * final answer, or one clarifying question. A malformed tool call (unknown
 * name) is fed back as a tool error, not executed.
 */
import type {
  AgentMessage,
  AgentRunOptions,
  AgentRunResult,
  AgentTool,
  DispatchFn,
  ModelFn,
} from './types.js';
import { toolsForMode, getTool } from './toolSchemas.js';

const DEFAULT_MAX_STEPS = 16;

/**
 * M9 Phase E — context hygiene for a long run. Tool results are already capped
 * at 6000 chars each (dispatch.ts); this collapses the OLD ones to a one-line
 * stub once the transcript grows past `KEEP_FULL_TOOL_RESULTS` of them, so a
 * smaller-context provider does not fill up. The recent turns stay verbatim
 * (they are what the model is actually reasoning about), and the answer text /
 * tool-call args are never touched.
 */
const KEEP_FULL_TOOL_RESULTS = 5;

function stubToolResult(name: string, result: unknown): unknown {
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    if ('error' in r) return { summarized: `${name} → error: ${String(r.error).slice(0, 120)}` };
    const n = Array.isArray(r.results) ? r.results.length : Array.isArray(r.chunks) ? r.chunks.length : undefined;
    return { summarized: n !== undefined ? `${name} → ${n} result(s) (details trimmed)` : `${name} → done (details trimmed)` };
  }
  return { summarized: `${name} → done (details trimmed)` };
}

/** Collapse all but the last `KEEP_FULL_TOOL_RESULTS` tool results to a stub. Pure. */
export function compactMessages(messages: AgentMessage[]): AgentMessage[] {
  const toolIdx = messages.flatMap((m, i) => (m.role === 'tool' ? [i] : []));
  if (toolIdx.length <= KEEP_FULL_TOOL_RESULTS) return messages;
  const collapseBefore = toolIdx[toolIdx.length - KEEP_FULL_TOOL_RESULTS];
  return messages.map((m, i) =>
    m.role === 'tool' && i < collapseBefore
      ? { ...m, result: stubToolResult(m.name, m.result) }
      : m,
  );
}

/**
 * The i18n key for a step's progress label (M11 Phase 2). `shared/` can't
 * translate — the renderer does `t(labelKey, label)`, falling back to the
 * English `label` (from `labelFor`) for any key not in the locale. Every
 * step-emitting `onProgress` call carries both.
 */
function stepLabelKey(name: string): string {
  return `agent.step.${name}`;
}

/** A short present-tense label for a tool call, for the live progress line. */
function labelFor(name: string): string {
  switch (name) {
    case 'list_capabilities': return 'checking what this machine can do';
    case 'read_document': return 'reading the chapter';
    case 'search_corpus': return 'searching the corpus';
    case 'search_shamela': return 'searching Shamela';
    case 'read_shamela_page': return 'reading the Shamela page';
    case 'find_shamela_book': return 'looking up the Shamela book';
    case 'search_general': return 'asking the General research channel';
    case 'research_topic': return 'researching the topic';
    case 'search_repositories': return 'searching global repositories';
    case 'query_tafseer': return 'consulting the tafsir sources';
    case 'search_hadith': return 'searching the hadith collections';
    case 'grade_hadith': return 'grading the hadith with الدرر السنية';
    case 'lookup_narrator': return 'looking up the narrator in the rijāl literature';
    case 'lookup_lexicon': return 'looking the word up in the Arabic–Urdu lexicon';
    case 'search_persian_poetry': return 'searching Persian poetry (Ganjoor)';
    case 'scan_urdu_prosody': return 'scanning the metre';
    case 'lookup_urdu_verse': return 'looking up the verse';
    case 'calculate_zakat': return 'calculating the zakat due';
    case 'calculate_faraid': return 'calculating the inheritance shares';
    case 'insert_footnote': return 'inserting the footnote';
    case 'add_document_comment': return 'adding a margin comment';
    case 'set_page_layout': return 'setting the page layout';
    case 'convert_document': return 'converting the document';
    case 'run_task': return 'running the text task';
    case 'extract_author_voice': return 'learning your writing voice';
    case 'critique': return 'getting a critical review';
    case 'compile_ai_disclosure': return 'compiling the AI-assistance disclosure';
    case 'run_playbook': return 'running the playbook';
    case 'draft_section': return 'drafting the section';
    case 'create_chapter': return 'creating the chapter';
    case 'transcribe_media': return 'transcribing the recording';
    case 'compare_manuscript_variants': return 'comparing the manuscript witnesses';
    case 'typeset_print_ready': return 'applying the print layout';
    case 'build_scholarly_indexes': return 'building the indexes';
    case 'ocr_document': return 'reading the scanned pages';
    case 'install_font': return 'installing the font';
    case 'install_template': return 'installing the template';
    case 'set_global_option': return 'requesting a Word setting change';
    default: return `running ${name}`;
  }
}

export async function runAgentLoop(
  userInstruction: string,
  model: ModelFn,
  dispatch: DispatchFn,
  systemPrompt: string,
  opts: AgentRunOptions & { tools?: AgentTool[] },
): Promise<AgentRunResult> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const tools = opts.tools ?? toolsForMode(opts.mode);
  // M11 Phase 1 — `opts.history` (prior turns, `user`/`model`-text only — see
  // shared/agent/history.ts) is prepended so a follow-up has the thread.
  const messages: AgentMessage[] = [
    ...(opts.history ?? []),
    { role: 'user', text: userInstruction },
  ];
  const toolCalls: AgentRunResult['toolCalls'] = [];

  // Plan mode: the first write is gated on the scholar approving the plan.
  let planApproved = opts.mode !== 'plan' || !opts.waitForApproval;

  let step = 0;
  while (step < maxSteps) {
    if (opts.isCancelled?.()) {
      return finish('cancelled', '', messages, toolCalls, step);
    }
    step += 1;
    opts.onProgress?.({ step, label: 'thinking', kind: 'thinking' });

    let next;
    try {
      next = await model(compactMessages(messages), tools, systemPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.onProgress?.({ step, label: 'error', labelKey: 'agent.step.error', kind: 'error', detail: msg });
      return finish('error', '', messages, toolCalls, step, msg);
    }

    if (next.kind === 'text') {
      messages.push({ role: 'model', text: next.text });
      opts.onProgress?.({ step, label: 'done', labelKey: 'agent.step.done', kind: 'done' });
      return finish('done', next.text, messages, toolCalls, step);
    }

    if (next.kind === 'clarify') {
      messages.push({ role: 'model', text: next.question });
      opts.onProgress?.({ step, label: 'needs a clarification', labelKey: 'agent.step.needs_clarification', kind: 'clarify', question: next.question });
      return { ...finish('needs-input', '', messages, toolCalls, step), question: next.question };
    }

    // A tool call.
    const { name, args } = next;
    messages.push({ role: 'model', toolCall: { name, args } });

    const tool = getTool(name);
    if (!tool) {
      messages.push({ role: 'tool', name, result: { error: `unknown tool: ${name}` } });
      opts.onProgress?.({ step, label: labelFor(name), labelKey: stepLabelKey(name), kind: 'error', detail: `unknown tool: ${name}` });
      continue;
    }
    if (opts.mode === 'ask' && tool.effect === 'write') {
      messages.push({ role: 'tool', name, result: { error: `"${name}" makes changes and is not available in Ask mode` } });
      opts.onProgress?.({ step, label: labelFor(name), labelKey: stepLabelKey(name), kind: 'error', detail: 'blocked in Ask mode' });
      continue;
    }

    // Plan mode — hold at the first write until the scholar approves.
    if (!planApproved && tool.effect === 'write' && opts.waitForApproval) {
      const stepsSoFar = toolCalls.map((c) => labelFor(c.name));
      const decision = await opts.waitForApproval({
        steps: [...stepsSoFar, `${labelFor(name)} — and continue`],
        summary: `The agent is ready to start making changes, beginning with: ${labelFor(name)}.`,
      });
      if (decision !== 'approved') {
        opts.onProgress?.({ step, label: 'plan not approved', labelKey: 'agent.step.plan_not_approved', kind: 'plan-pending' });
        return { ...finish('needs-input', '', messages, toolCalls, step), question: 'The plan was not approved — adjust the request and try again.' };
      }
      planApproved = true;
    }

    opts.onProgress?.({ step, label: labelFor(name), labelKey: stepLabelKey(name), kind: 'tool' });
    let result: unknown;
    try {
      result = await dispatch(name, args);
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }
    toolCalls.push({ name, args, result });
    messages.push({ role: 'tool', name, result });
    opts.onProgress?.({
      step,
      label: labelFor(name),
      labelKey: stepLabelKey(name),
      kind: 'tool-result',
      detail: typeof result === 'object' && result && 'error' in result ? String((result as { error: unknown }).error) : undefined,
    });
  }

  return finish('step-limit', '', messages, toolCalls, step);
}

function finish(
  stopReason: AgentRunResult['stopReason'],
  answer: string,
  messages: AgentMessage[],
  toolCalls: AgentRunResult['toolCalls'],
  steps: number,
  error?: string,
): AgentRunResult {
  return { answer, messages, toolCalls, steps, stopReason, ...(error ? { error } : {}) };
}

export { labelFor, stepLabelKey };
