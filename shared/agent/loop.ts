/**
 * M8 Layer 6 — the agentic loop (SPEC-M8 §3, ADR-0016).
 *
 * Pure and injectable: the loop takes a `ModelFn` (the real one calls Gemini
 * with function-calling; tests pass a scripted fake) and a `DispatchFn` (runs
 * one tool call against the real adapters). It maintains the conversation,
 * enforces a hard step limit, emits a progress event per step, and stops on a
 * final text answer, the step limit, cancellation, or an error.
 *
 * ADR-0016 control 1: the loop never fabricates "the task" as free-form
 * prose — the model can only return a tool call from the closed registry or a
 * final answer. A malformed tool call (unknown name) is fed back as a tool
 * error, not executed.
 */
import type {
  AgentMessage,
  AgentRunOptions,
  AgentRunResult,
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
    case 'insert_footnote': return 'inserting the footnote';
    case 'set_page_layout': return 'setting the page layout';
    case 'convert_document': return 'converting the document';
    case 'run_task': return 'running the text task';
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
  opts: AgentRunOptions,
): Promise<AgentRunResult> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const tools = toolsForMode(opts.mode);
  const messages: AgentMessage[] = [{ role: 'user', text: userInstruction }];
  const toolCalls: AgentRunResult['toolCalls'] = [];

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
