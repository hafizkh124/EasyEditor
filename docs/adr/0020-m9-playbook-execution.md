# ADR 0020 — Playbooks Are Executed, Not Advised

**Status:** Accepted · **Date:** 2026-09-03 · **Milestone:** SPEC-M9

## Context

M8 shipped a playbook registry (`shared/playbooks/registry.ts`) and designed a
`run_playbook` tool (SPEC-M8 §3 Layer 4, `toolSchemas.ts:8`) that was never
built. In practice `electron/agent/run.ts` only appended a matched playbook's
step notes to the system prompt as *advice*; the model still chose every step,
in any order, and could skip or invent steps. The M9 premise — a short prompt or
one `/command` runs a complete scholarly pipeline end to end — needs the
playbook to actually own control flow, which ADR-0016 control 1 already calls
for ("the agent selects a procedure, it does not invent one").

## Decision

A **deterministic step executor** replaces advisory-prose seeding.

- `shared/playbooks/executor.ts` (pure) — `validatePlaybook` checks every step
  against the closed registry (tool exists; seeded and bound args are real
  parameters; every required arg is seeded, bound, or context-suppliable).
  `planPlaybook` seeds args from the run context (chapter, `@mention` paths) and
  marks which args still need filling.
- `electron/agent/runPlaybook.ts` — drives the plan against the real
  dispatcher. A step whose args are fully specified dispatches with **no model
  call**. A step with `bind` names gets **one scoped, forced call to that single
  tool** (`generateBoundCall`, Gemini `functionCallingConfig.mode: 'ANY'` over a
  one-tool list) — the model cannot pick another tool, reorder, skip, or answer
  with text.
- The `Playbook` type gains `trigger` (the `/command`), `guidance` (domain prose
  appended to the system prompt for that run only), and per-step `bind` /
  `optional`.
- `selectPlaybook` resolves an exact leading `/trigger` outright; the keyword
  count is the fallback. `run.ts` routes a `/trigger` or a ≥2-keyword match to
  `runPlaybook`; everything else to the free `runAgentLoop`.
- `run_playbook` is also a registry tool, so the free loop can invoke a whole
  playbook mid-task (`session.runPlaybookRef`).

## A playbook is never a dead end

If a non-`optional` step fails (tool missing, dispatch error, or the bound model
call would not follow the step), `runPlaybook` **hands off to `runAgentLoop`**,
seeded with what the playbook achieved so far and told to finish. An `optional`
step that cannot run is skipped, not failed.

## Consequences

- The 7 M8 playbooks were converted to the `trigger` form. The `thesis-
  university-format` playbook's `run_task {task: 'citations'}` step — which the
  dispatcher has always rejected (`dispatch.ts`) and which only ever "worked"
  because steps were prose — was fixed (M9 defect #1). `agentPlaybooks.test.ts`
  now runs `validatePlaybook` over every playbook, and validates `step.args`,
  which it did not before.
- Plan mode (ADR-0026) hooks the executor: the plan is emitted as an artifact
  and `waitForApproval` gates the first write.
- Adding a playbook stays a single registry entry.
