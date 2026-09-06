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
import type { AgentModel } from './modelRouter.js';
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
  /** The active provider's model fns (M9 Phase C) — bind calls, `hasMore`, synthesis, fallback loop. */
  model: Pick<AgentModel, 'generate' | 'generateBound'>;
  systemPrompt: string;
  onProgress?: (p: AgentProgress) => void;
  emitArtifact?: EmitArtifactFn;
  isCancelled?: () => boolean;
  waitForApproval?: WaitForApprovalFn;
  /** Full tool set for the fallback loop (already mode/scope-filtered). */
  fallbackTools: AgentTool[];
  /** Tools whose connector the scholar switched off — their steps are skipped (M9 Phase 1b). */
  disabledTools?: Set<string>;
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
  /** Signal from a step handler that the whole run should hand off to the loop. */
  const HANDOFF = Symbol('handoff');
  type StepOutcome = { errored: boolean; needsConsent: boolean } | typeof HANDOFF | 'skip';

  /** Prepare args (scoped bind call), dispatch once, record. */
  const runStepOnce = async (
    step: typeof plan.steps[number],
    tool: NonNullable<ReturnType<typeof getTool>>,
    iteration: number,
  ): Promise<StepOutcome> => {
    let args = { ...step.args };
    if (step.bind.length) {
      input.onProgress?.({ step: stepNo, kind: 'thinking', label: `working out: ${step.note}` });
      const scopedPrompt =
        `${systemPrompt}\n\n── This step${iteration > 0 ? ` (item ${iteration + 1})` : ''} ──\n${step.note}\n` +
        `Call ${tool.name} with the right arguments for: "${instruction}".` +
        (Object.keys(args).length ? `\nThese arguments are already fixed: ${JSON.stringify(args)}.` : '');
      try {
        const bound = await input.model.generateBound(messages, tool, scopedPrompt);
        if (bound.name !== step.tool) {
          log.warn('bound step returned a different tool', { expected: step.tool, got: bound.name });
          return step.optional ? 'skip' : HANDOFF;
        }
        args = { ...bound.args, ...args };
      } catch (err) {
        log.warn('bind call failed', { step: step.note, message: (err as Error).message });
        return step.optional ? 'skip' : HANDOFF;
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
    // ocr_document / set_global_option return `needsConsent` (no `error`) the
    // first time — nothing was applied, they are asking the scholar to
    // approve before doing anything. Treated as "not actually done" so the
    // playbook stops here instead of continuing to a step that assumes this
    // one's output exists (e.g. building a chapter from OCR text that was
    // never produced) or reporting it as one of the steps "applied".
    const needsConsent = typeof result === 'object' && result !== null
      && 'needsConsent' in result && Boolean((result as { needsConsent?: unknown }).needsConsent);
    input.onProgress?.({
      step: stepNo, kind: 'tool-result', label: step.note,
      detail: errored ? String((result as { error: unknown }).error) : undefined,
    });
    return { errored, needsConsent };
  };

  /** For a `repeat` step: is there another instance to handle? (bounded, cheap) */
  const REPEAT_MAX = 8;
  const hasMore = async (step: typeof plan.steps[number]): Promise<boolean> => {
    try {
      const ask = await input.model.generate(
        [...messages, { role: 'user', text: `For the step "${step.note}", is there another distinct item still to handle? Answer only "yes" or "no".` }],
        [],
        systemPrompt,
      );
      return ask.kind === 'text' && /^\s*(yes|نعم|ہاں|جی)/i.test(ask.text);
    } catch {
      return false;
    }
  };

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
    if (input.disabledTools?.has(step.tool)) {
      input.onProgress?.({ step: stepNo, kind: 'tool-result', label: step.note, detail: 'skipped — that source connector is off for this project' });
      if (!step.optional) log.info('playbook step skipped: connector off', { tool: step.tool });
      continue;
    }
    if (mode === 'ask' && tool.effect === 'write') {
      input.onProgress?.({ step: stepNo, kind: 'tool-result', label: step.note, detail: 'skipped — Ask mode is read-only' });
      continue;
    }

    for (let iter = 0; iter < (step.repeat ? REPEAT_MAX : 1); iter += 1) {
      if (iter > 0) { stepNo += 1; }
      const outcome = await runStepOnce(step, tool, iter);
      if (outcome === HANDOFF) return fallbackLoop(input, toolCalls, `the model would not follow step "${step.note}"`);
      if (outcome === 'skip') break;
      if (outcome.needsConsent) {
        // Nothing further can run until the scholar approves in the Agent
        // panel (the consent card renders off `toolCalls`, scanned there
        // regardless of `answer`/`stopReason`) — stop rather than build the
        // next step on output this one never produced.
        input.emitArtifact?.({ op: 'close', artifactId, status: 'aborted' });
        return {
          answer: 'This step needs your approval first — see below, then run the task again.',
          messages, toolCalls, steps: stepNo, stopReason: 'done',
        };
      }
      if (outcome.errored && !step.optional) {
        return fallbackLoop(input, toolCalls, `step "${step.note}" did not complete`);
      }
      if (!step.repeat) break;
      if (outcome.errored) break; // an optional repeat step that errored — stop repeating
      if (!(await hasMore(step))) break;
      if (input.isCancelled?.()) break;
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
      const synth = await input.model.generate(
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
  const result = await runAgentLoop(seed, input.model.generate, input.dispatch, input.systemPrompt, {
    mode: input.mode,
    tools: input.fallbackTools,
    onProgress: input.onProgress,
    isCancelled: input.isCancelled,
    waitForApproval: input.waitForApproval,
  });
  return { ...result, toolCalls: [...priorCalls, ...result.toolCalls] };
}

function summarise(pb: Playbook, calls: AgentRunResult['toolCalls']): string {
  const ok = calls.filter((c) => {
    const r = c.result;
    const incomplete = typeof r === 'object' && r !== null && ('error' in r || Boolean((r as { needsConsent?: unknown }).needsConsent));
    return !incomplete;
  }).length;
  return `Ran the "${pb.title}" playbook — ${ok} of ${calls.length} step${calls.length === 1 ? '' : 's'} applied. Review the tracked changes in Word.`;
}
