# ADR 0030 — Live-Model Eval Harness

**Status:** Accepted · **Date:** 2026-09-06 · **Milestone:** SPEC-M9 (Phase B)

## Context

The 27 agent test files all inject a scripted `ModelFn` — they prove the
**contract** (the loop feeds errors back, the ledger gates `insert_footnote`,
Ask mode blocks writes, a playbook's `bind` step forces one tool). None of them
tell us whether the **real model** makes good decisions: retrieve before it
cites, never invent a source, pick the right tool, honour a forced call, stop
when the job is done.

That gap is the blocker for ADR-0031 (multi-provider). Swapping Gemini for Groq
or DeepSeek is only safe if we can measure that the grounding and
tool-selection quality holds. So Phase B builds the measurement first.

## Decisions

**Swap exactly one thing — the ModelFn.** `src/test/fixtures/agentEval/world.ts`
gives every scenario a deterministic `DispatchFn`: fixed chapters, a fixed set
of retrievable chunks, canned `search_general`. The `RetrievalLedger` runs for
real, so `insert_footnote`'s integrity gate is the production one. A metric
change therefore means a **model** change, not a backend flake.

**A golden set as data.** `scenarios.ts` — 9 real tasks to start (cite a
hadith, answer in Ask mode, "what does the chapter say" → `search_corpus` not
`read_document`, no-source-no-invention, RTL layout, grounded `draft_section`,
don't-overwork, General-is-never-a-citation, the `add-verified-citations`
playbook). Each declares what a competent run must do. Grow the list over time.

**Scoring is pure and CI-tested.** `score.ts` turns `(scenario, AgentRunResult,
dispatchCalls)` into pass/fail + metrics: `citationResolveRate`,
`groundingViolations`, `steps`, tool-choice checks. `agentEvalScore.test.ts`
runs in CI (no network) and also drives `runAgentLoop` with a scripted model to
prove the plumbing.

**Env-gated, like `hostLive.test.ts`.** `describe.runIf(AGENT_EVAL_LIVE === '1'
&& GEMINI_API_KEY)`. `getDecryptedGeminiKey()` gained a `process.env.
GEMINI_API_KEY` fallback (BYOK still wins) so a headless run has a key.
`it.each` over the golden set, then one `it` asserting the aggregate meets
`baseline.json`. A JSON report lands in `test-results/`.

**Baseline is a committed floor, re-stamped deliberately.** `baseline.json`
ships with conservative thresholds, not the real Gemini numbers (I could not
run the paid eval). `AGENT_EVAL_WRITE_BASELINE=1` stamps the observed run;
thresholds are then tightened by hand. A Phase-C provider must clear this same
file to become selectable.

## Consequences

- New: `src/test/fixtures/agentEval/{world,scenarios,score,baseline.json}.ts`,
  `src/test/agentEval.live.test.ts`, `src/test/agentEvalScore.test.ts`.
- `electron/ai/keyStore.ts` — env-var fallback in `getDecryptedGeminiKey`.
- Phase C swaps `modelFn` in the live test per provider; the scenarios and
  scoring are provider-agnostic already.
