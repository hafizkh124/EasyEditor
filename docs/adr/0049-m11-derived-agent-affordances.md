# ADR 0049 — Agent Affordances Are Derived, Not Emitted

**Status:** Accepted · **Date:** 2026-09-10 · **Milestone:** M11 (Phase 2) · **Relates to:** [ADR-0024](./0024-m9-agent-artifact-channel.md), [ADR-0027](./0027-m9-efficiency-and-intent-precision.md)

## Context

M11 Phase 2 adds three things to the agent run surface: localised progress
lines, a live metrics row (`⚙️ 3 tools · 2 sources · 01:24`), and "what next?"
chips after an answer. The tempting design for each is a new `AgentProgress`
kind or a model call. Both were rejected.

## Decisions

**Progress labels carry an i18n key, not translated text.** `shared/` can't
translate. `loop.ts` emits `labelKey: 'agent.step.<tool>'` alongside the
English `label`; the renderer does `t(labelKey, label)`, so a key missing from
a locale degrades to English inline. A full `agent.step.*` family ships in all
three locales (pinned by `agentStepKeys.test.ts` against the closed tool
registry). Fixes a real defect: a run's timeline mixed hard-coded English
(`loop.ts`) with hard-coded Urdu (`batch.ts`) regardless of UI language. The
retired `agent.mode_do` / `agent.hint_do` keys (dead since the mode set became
`ask|plan|auto`) are removed.

**The metrics row is derived from progress lines — no new event.**
`shared/agent/runStats.ts` `deriveRunStats(progress)` counts tool calls,
failures, and retrieval results from the lines the renderer already holds. The
elapsed timer is renderer-local (`RunStatsBar`). Zero IPC change. This mirrors
how provenance chips are already derived via `connectorsUsed(toolCalls)`
(ADR-0038) rather than a `provenance` event.

**"What next?" chips are DETERMINISTIC.** `shared/agent/recommendations.ts`
`recommendActions({ artifacts, toolCalls, mode, hasProjectFolder })` returns at
most four chips from fixed rules (a table artifact → open it; a citable search
in a write mode with no footnote yet → offer footnotes; a drafted chapter →
offer print layout + indexes; a transcription → offer transcript→chapter; a
takhrīj → offer a matn comparison). **No model call** — it is free, instant,
and unit-testable. Non-artifact chips pre-fill the composer with a follow-up
instruction (a `/trigger` or a sentence) and never auto-send — the scholar
reviews it, consistent with ADR-0026's "no silent writes".

**A message typed mid-run is queued, not dropped.** `useAgentRun` holds one
`queuedMessage`; the composer textarea is no longer `disabled` while a run is
in flight. The queued message flushes through the same `send()` path when the
run finishes. The main-process single-slot agent mutex (`queue.ts`) is
untouched — the queue is renderer-side, one slot, replace-not-append.

## Consequences

- New: `shared/agent/runStats.ts`, `shared/agent/recommendations.ts`;
  `AgentProgress.labelKey`; `agent.step.*` + `agent.rec.*` + `agent.stats_*`
  i18n keys; `RunStatsBar.tsx`; `useAgentRun`'s `runStats` / `recommendations` /
  `applyRecommendation` / `queuedMessage` / `cancelQueued` / `editQueued`.
- `labelFor` stays (English, for the plan-steps artifact text); `stepLabelKey`
  is its keyed sibling.
- Bug fixed alongside: `openProjectFolder` now scaffolds `export/` etc.
  (`createProjectFolder` did; a pre-existing plain `.docx` folder did not, so
  `convert_document` threw on it — `assertSafeOutputPath` needs the parent dir).
- Tests: `agentStepKeys` (5), `agentRunStats` (4), `agentRecommendations` (7),
  labelKey + queue cases in `chatDisplay` / `agentPanel`.
- Deferred: the export chips (xlsx / png / copy-table) — they needed the
  table→file path from M11 Phase 4, which was itself broken until M12 Phase D
  (ADR-0050) fixed it. The **xlsx** chip (`build-spreadsheet`, offered after
  `calculate_zakat`/`calculate_faraid`) is now wired; PNG and copy-table stay
  deferred to M12 Phase F.
