/**
 * M9 ADR-0020 — the pure playbook step planner.
 *
 * Turns a `Playbook` + a run context into an ordered list of concrete tool
 * calls. A step whose args are fully specified in the registry is ready to
 * dispatch with NO model call. A step with `bind` names still needs those args
 * filled — the executor marks them; `electron/agent/runPlaybook.ts` does the
 * scoped single-tool model call to fill them and then dispatches.
 *
 * The model never chooses WHICH step runs, in what order, or whether to skip
 * one — that is fixed here (ADR-0016 control 1).
 *
 * Pure — no runtime globals.
 */
import type { Playbook, PlaybookStep } from './registry.js';
import { getTool } from '../agent/toolSchemas.js';

export interface PlaybookContext {
  /** The chapter the run acts on, if known (from an @mention or the ask). */
  chapter?: string;
  /** Absolute in-project paths from @mentions, keyed loosely by the ask. */
  mentions?: Record<string, string>;
  /** The scholar's original instruction — passed to scoped bind calls. */
  instruction?: string;
}

export interface ResolvedStep {
  index: number;
  tool: string;
  /** Seed args from the registry, merged with anything the context supplies. */
  args: Record<string, unknown>;
  /** Arg names still to be filled by a scoped model call before dispatch. */
  bind: string[];
  optional: boolean;
  note: string;
}

export interface PlaybookPlan {
  playbookId: string;
  title: string;
  steps: ResolvedStep[];
  /** One-paragraph description for Plan-mode approval. */
  summary: string;
}

/**
 * Static checks — every step names a real tool, and every seeded/bound arg is a
 * real parameter of that tool. Returns [] when the playbook is sound.
 */
export function validatePlaybook(pb: Playbook): string[] {
  const problems: string[] = [];
  if (!pb.steps.length) problems.push(`playbook "${pb.id}" has no steps`);

  pb.steps.forEach((step, i) => {
    const tool = getTool(step.tool);
    if (!tool) {
      problems.push(`step ${i + 1}: unknown tool "${step.tool}"`);
      return;
    }
    const known = new Set(Object.keys(tool.params));
    for (const k of Object.keys(step.args ?? {})) {
      if (!known.has(k)) problems.push(`step ${i + 1} (${step.tool}): seeded arg "${k}" is not a parameter of this tool`);
    }
    for (const k of step.bind ?? []) {
      if (!known.has(k)) problems.push(`step ${i + 1} (${step.tool}): bind arg "${k}" is not a parameter of this tool`);
    }
    // A required arg that is neither seeded nor bound nor context-suppliable.
    for (const req of tool.required) {
      const seeded = step.args && req in step.args;
      const bound = (step.bind ?? []).includes(req);
      const contextual = req === 'chapter';
      if (!seeded && !bound && !contextual) {
        problems.push(`step ${i + 1} (${step.tool}): required arg "${req}" is neither seeded nor bound`);
      }
    }
  });

  return problems;
}

/** Merge context into one step's args; drop bind names the context already fills. */
function resolveStep(step: PlaybookStep, index: number, ctx: PlaybookContext): ResolvedStep {
  const args: Record<string, unknown> = { ...(step.args ?? {}) };
  let bind = [...(step.bind ?? [])];

  // The chapter is the one arg the run context routinely supplies.
  if ((bind.includes('chapter') || getTool(step.tool)?.required.includes('chapter')) && ctx.chapter && args.chapter === undefined) {
    args.chapter = ctx.chapter;
    bind = bind.filter((b) => b !== 'chapter');
  }

  // @mention paths, when a step binds a *_path arg.
  for (const b of [...bind]) {
    if (b.endsWith('_path') && ctx.mentions && ctx.mentions[b]) {
      args[b] = ctx.mentions[b];
      bind = bind.filter((x) => x !== b);
    }
  }

  return {
    index,
    tool: step.tool,
    args,
    bind,
    optional: Boolean(step.optional),
    note: step.note,
  };
}

export function planPlaybook(pb: Playbook, ctx: PlaybookContext = {}): PlaybookPlan {
  const steps = pb.steps.map((s, i) => resolveStep(s, i, ctx));
  const lines = steps.map((s, i) => `  ${i + 1}. ${s.note}${s.optional ? ' (skipped if not applicable)' : ''}`);
  const summary = `Playbook "${pb.title}" — ${steps.length} step${steps.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
  return { playbookId: pb.id, title: pb.title, steps, summary };
}
