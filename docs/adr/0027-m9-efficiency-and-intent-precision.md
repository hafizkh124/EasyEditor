# ADR 0027 — Efficiency and Intent Precision

**Status:** Accepted · **Date:** 2026-09-03 · **Milestone:** SPEC-M9

## Context

Six practices from production agentic systems (DeepMind / Anthropic / OpenAI)
for spending fewer tokens and picking the right tool. Each maps onto an existing
seam in EasyEditor's agent core. Built in Phase 0; F3 and F4 are re-applied as
each new tool lands.

## Decisions

**F1 — Fast path.** `shared/agent/fastPath.ts` (pure). A pure linguistic /
editing ask on one identifiable chapter (اعراب, spelling, paraphrase, summary,
auto-format, …) maps to a single `run_task` call — the loop never starts.
`run.ts` branches: fast path → direct dispatch; `/trigger` → `runPlaybook`;
else → `runAgentLoop`. **The fast path still opens a checkpoint and backs the
chapter up** — it writes a tracked change like any other path (M9 note).

**F2 — Dynamic tool pruning.** `shared/agent/toolScoping.ts` (pure). `toolsFor
(mode, { ask, playbook })` narrows `toolsForMode`'s output by the matched
playbook's steps, or by keyword domain (tafsir / hadith / fonts / print). Two
invariants it must never break, both asserted in `agentToolScoping.test.ts`:
- **FLOOR** — `list_capabilities`, `read_document`, `search_corpus` always
  present.
- **Citation closure** — if any citable search tool is exposed in a
  write-capable mode, `insert_footnote` is exposed too.

**F3 — Negative tool boundaries.** Every `toolSchemas.ts` description carries an
explicit "Do NOT use when …" clause. A per-tool exit-criteria item for every new
tool.

**F4 — Source budgeting.** `dispatch.ts` — `capResult(text, 6000)` on every
search tool's returned text (M8 capped nothing at the agent boundary; the only
cap was `electron/tafsir/allowlist.ts:45`, on a different IPC path). Hard
`limit` clamps: `search_corpus` / `search_shamela` max 12.

**F5 — Early stop.** `systemPrompt.ts` BASE: "Stop as soon as the core
requirement is met. Do not do unsolicited secondary work." The executor already
halts at the last playbook step; this governs the free loop.

**F6 — Ask vs guess.** A `clarify` pseudo-tool (`CLARIFY_TOOL`, not in the
executable registry). The model may call `ask_clarifying_question` on a
genuinely ambiguous ask; `geminiTools.ts` turns it into a `clarify` ModelStep;
`runAgentLoop` finishes `stopReason: 'needs-input'` with the question, which the
panel surfaces with a reply box. Bounded to one per run.

## Consequences

- `shared/agent/loop.ts` accepts an optional `tools` override so `run.ts` can
  pass the pruned set. `labelFor` gained labels for every M9 tool up front.
- `stopReason` gains `'needs-input'` (also used by ADR-0026 Plan rejection).
