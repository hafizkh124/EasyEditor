/**
 * M9 ADR-0020 — the deterministic playbook runner.
 *
 * Owns control flow: which step runs, in what order, and whether an optional
 * step is skipped are all fixed by the playbook, not the model. A step with
 * fully-specified args dispatches with NO model call; a step with `bind` names
 * gets ONE scoped, forced call to that single tool to fill them.
 *
 * A step that fails (and is not `optional`) hands off to the free agentic loop,
 * seeded with what the playbook achieved so far — a playbook is never a dead
 * end.
 */
import { logger } from '../lib/logger.js';
import { planPlaybook, validatePlaybook, type PlaybookContext } from '../../shared/playbooks/executor.js';
import type { Playbook } from '../../shared/playbooks/registry.js';
import { getTool } from '../../shared/agent/toolSchemas.js';
import { runAgentLoop } from '../../shared/agent/loop.js';
import { generateWithTools, generateBoundCall } from './geminiTools.js';
import type {
  AgentMessage,
  AgentMode,
  AgentProgress,
  AgentRunResult,
  AgentTool,
  DispatchFn,
  EmitArtifactFn,
  WaitForApprovalFn,
} from '../../shared/agent/types.js';

const log = logger.child('agent/runPlaybook');

export interface RunPlaybookInput {
  playbook: Playbook;
  instruction: string;
  mode: AgentMode;
  context: PlaybookContext;
  dispatch: DispatchFn;
  systemPrompt: string;
  onProgress?: (p: AgentProgress) => void;
  emitArtifact?: EmitArtifactFn;
  isCancelled?: () => boolean;
  waitForApproval?: WaitForApprovalFn;
  /** Full tool set for the fallback loop (already mode/scope-filtered). */
  fallbackTools: AgentTool[];
}

export async function runPlaybook(input: RunPlaybookInput): Promise<AgentRunResult> {
  const { playbook, instruction, mode, context, dispatch, systemPrompt } = input;

  const problems = validatePlaybook(playbook);
  if (problems.length) {
    log.warn('playbook failed validation — using the free loop', { id: playbook.id, problems });
    return fallbackLoop(input, [], 'this playbook is not runnable as configured');
  }

  const plan = planPlaybook(playbook, context);
  const artifactId = `plan-${playbook.id}`;

  input.emitArtifact?.({ op: 'open', artifactId, title: playbook.title, artifactType: 'plan' });
  input.emitArtifact?.({ op: 'delta', artifactId, mode: 'replace', text: plan.summary });

  // Plan mode — hold for approval before any step runs.
  if (mode === 'plan' && input.waitForApproval) {
    input.onProgress?.({ kind: 'plan-pending', label: 'waiting for you to approve the plan' });
    const decision = await input.waitForApproval({ steps: plan.steps.map((s) => s.note), summary: plan.summary });
    if (decision !== 'approved') {
      input.emitArtifact?.({ op: 'close', artifactId, status: 'aborted' });
      return {
        answer: '', messages: [], toolCalls: [], steps: 0, stopReason: 'needs-input',
        question: 'The plan was not approved — adjust the request and try again.',
      };
    }
  }

  const messages: AgentMessage[] = [{ role: 'user', text: instruction }];
  const toolCalls: AgentRunResult['toolCalls'] = [];
  let stepNo = 0;

  for (const step of plan.steps) {
    if (input.isCancelled?.()) {
      input.emitArtifact?.({ op: 'close', artifactId, status: 'aborted' });
      return { answer: '', messages, toolCalls, steps: stepNo, stopReason: 'cancelled' };
    }
    stepNo += 1;
    const tool = getTool(step.tool);
    if (!tool) {
      if (step.optional) { continue; }
      return fallbackLoop(input, toolCalls, `step "${step.tool}" is not a known tool`);
    }

    // Ask mode never runs a write step.
    if (mode === 'ask' && tool.effect === 'write') {
      input.onProgress?.({ step: stepNo, kind: 'tool-result', label: step.note, detail: 'skipped — Ask mode is read-only' });
      continue;
    }

    let args = { ...step.args };

    // Bind step — one scoped, forced call to exactly this tool.
    if (step.bind.length) {
      input.onProgress?.({ step: stepNo, kind: 'thinking', label: `working out: ${step.note}` });
      const scopedPrompt =
        `${systemPrompt}\n\n── This step ──\n${step.note}\nCall ${tool.name} with the right arguments for: "${instruction}".` +
        (Object.keys(args).length ? `\nThese arguments are already fixed: ${JSON.stringify(args)}.` : '');
      try {
        const bound = await generateBoundCall(messages, tool, scopedPrompt);
        if (bound.name !== step.tool) {
          log.warn('bound step returned a different tool', { expected: step.tool, got: bound.name });
          if (!step.optional) return fallbackLoop(input, toolCalls, `the model would not follow step "${step.note}"`);
          continue;
        }
        args = { ...bound.args, ...args }; // seeded args always win
      } catch (err) {
        if (step.optional) { continue; }
        return fallbackLoop(input, toolCalls, `could not prepare step "${step.note}": ${(err as Error).message}`);
      }
    }

    input.onProgress?.({ step: stepNo, kind: 'tool', label: step.note });
    let result: unknown;
    try {
      result = await dispatch(step.tool, args);
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }
    toolCalls.push({ name: step.tool, args, result });
    messages.push({ role: 'model', toolCall: { name: step.tool, args } });
    messages.push({ role: 'tool', name: step.tool, result });

    const errored = typeof result === 'object' && result !== null && 'error' in result;
    input.onProgress?.({
      step: stepNo, kind: 'tool-result', label: step.note,
      detail: errored ? String((result as { error: unknown }).error) : undefined,
    });
    if (errored && !step.optional) {
      return fallbackLoop(input, toolCalls, `step "${step.note}" did not complete`);
    }
  }

  input.emitArtifact?.({ op: 'close', artifactId, status: 'final', targetChapter: context.chapter });

  // If the playbook only retrieved (e.g. Ask mode, or every write step skipped),
  // do ONE synthesis call so the scholar gets an answer, not just a tally.
  const wrote = toolCalls.some((c) => {
    const t = getTool(c.name);
    return t?.effect === 'write' && !(typeof c.result === 'object' && c.result && 'error' in c.result);
  });
  let done = summarise(playbook, toolCalls);
  if (!wrote && toolCalls.some((c) => !(typeof c.result === 'object' && c.result && 'error' in c.result))) {
    try {
      const synth = await generateWithTools(
        [...messages, { role: 'user', text: 'Using only what was retrieved above, give the scholar a concise, sourced answer. Cite each point by its reference. If the sources are silent on something, say so.' }],
        [],
        systemPrompt,
      );
      if (synth.kind === 'text' && synth.text.trim() && synth.text !== '(no response)') done = synth.text.trim();
    } catch (err) {
      log.warn('playbook synthesis call failed — using the tally', { message: (err as Error).message });
    }
  }

  input.onProgress?.({ step: stepNo, kind: 'done', label: 'playbook finished' });
  messages.push({ role: 'model', text: done });
  return { answer: done, messages, toolCalls, steps: stepNo, stopReason: 'done' };
}

/** Hand what the playbook achieved to the free loop and let it finish. */
async function fallbackLoop(
  input: RunPlaybookInput,
  priorCalls: AgentRunResult['toolCalls'],
  why: string,
): Promise<AgentRunResult> {
  const done = priorCalls.map((c) => `- ${c.name}`).join('\n');
  const seed =
    `${input.instruction}\n\n(The playbook "${input.playbook.title}" was started but stopped: ${why}. ` +
    (done ? `Steps already done:\n${done}\n` : '') +
    `Continue from here and finish the task.)`;
  const result = await runAgentLoop(seed, generateWithTools, input.dispatch, input.systemPrompt, {
    mode: input.mode,
    tools: input.fallbackTools,
    onProgress: input.onProgress,
    isCancelled: input.isCancelled,
    waitForApproval: input.waitForApproval,
  });
  return { ...result, toolCalls: [...priorCalls, ...result.toolCalls] };
}

function summarise(pb: Playbook, calls: AgentRunResult['toolCalls']): string {
  const ok = calls.filter((c) => !(typeof c.result === 'object' && c.result && 'error' in c.result)).length;
  return `Ran the "${pb.title}" playbook — ${ok} of ${calls.length} step${calls.length === 1 ? '' : 's'} applied. Review the tracked changes in Word.`;
}
