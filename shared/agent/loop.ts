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

/** A short present-tense label for a tool call, for the live progress line. */
function labelFor(name: string): string {
  switch (name) {
    case 'list_capabilities': return 'checking what this machine can do';
    case 'read_document': return 'reading the chapter';
    case 'search_corpus': return 'searching the corpus';
    case 'search_shamela': return 'searching Shamela';
    case 'search_general': return 'asking the General research channel';
    case 'search_repositories': return 'searching global repositories';
    case 'query_tafseer': return 'consulting the tafsir sources';
    case 'search_hadith': return 'searching the hadith collections';
    case 'insert_footnote': return 'inserting the footnote';
    case 'add_document_comment': return 'adding a margin comment';
    case 'set_page_layout': return 'setting the page layout';
    case 'convert_document': return 'converting the document';
    case 'run_task': return 'running the text task';
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
  const messages: AgentMessage[] = [{ role: 'user', text: userInstruction }];
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
      next = await model(messages, tools, systemPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.onProgress?.({ step, label: 'error', kind: 'error', detail: msg });
      return finish('error', '', messages, toolCalls, step, msg);
    }

    if (next.kind === 'text') {
      messages.push({ role: 'model', text: next.text });
      opts.onProgress?.({ step, label: 'done', kind: 'done' });
      return finish('done', next.text, messages, toolCalls, step);
    }

    if (next.kind === 'clarify') {
      messages.push({ role: 'model', text: next.question });
      opts.onProgress?.({ step, label: 'needs a clarification', kind: 'clarify', question: next.question });
      return { ...finish('needs-input', '', messages, toolCalls, step), question: next.question };
    }

    // A tool call.
    const { name, args } = next;
    messages.push({ role: 'model', toolCall: { name, args } });

    const tool = getTool(name);
    if (!tool) {
      messages.push({ role: 'tool', name, result: { error: `unknown tool: ${name}` } });
      opts.onProgress?.({ step, label: labelFor(name), kind: 'error', detail: `unknown tool: ${name}` });
      continue;
    }
    if (opts.mode === 'ask' && tool.effect === 'write') {
      messages.push({ role: 'tool', name, result: { error: `"${name}" makes changes and is not available in Ask mode` } });
      opts.onProgress?.({ step, label: labelFor(name), kind: 'error', detail: 'blocked in Ask mode' });
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
        opts.onProgress?.({ step, label: 'plan not approved', kind: 'plan-pending' });
        return { ...finish('needs-input', '', messages, toolCalls, step), question: 'The plan was not approved — adjust the request and try again.' };
      }
      planApproved = true;
    }

    opts.onProgress?.({ step, label: labelFor(name), kind: 'tool' });
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

export { labelFor };
