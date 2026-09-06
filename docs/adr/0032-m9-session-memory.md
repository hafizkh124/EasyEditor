# ADR 0032 — Session Memory and the Research Sub-run

**Status:** Accepted · **Date:** 2026-09-06 · **Milestone:** SPEC-M9 (Phase E)

## Context

Three 2026-practice gaps the blueprint review flagged (plan §3): `agent.run()`
is memory-less, a long run's tool results crowd the context, and there is no
way to offload a bounded investigation.

## Decisions

**The journal — `electron/agent/journal.ts`.** An append-only
`.easyeditor/journal.jsonl` (beside `history/`), one line per finished task:
instruction, mode, provider, stopReason, steps, chapters written, sources seen,
answer. Bounded to 300 lines; a corrupt line is skipped. `run.ts` writes one
from every return path (`finish()` wrapper) and folds a digest of the last 8
into the system prompt as **"── Recent agent work ── (context only — it may be
stale; verify with a tool)"**. Derived, disposable — deleting the file only
loses continuity.

**History compaction — `shared/agent/loop.ts` `compactMessages()`.** Once a run
holds more than 5 tool results, the older ones are collapsed to a one-line stub
(`{summarized: "search_corpus → 4 result(s) (details trimmed)"}`) **for the
model call only**. The returned `messages` transcript keeps everything (Trust
tab), and answer text / tool-call args are never touched. Pure.

**The research sub-run — the `research_topic` tool.** A read-only tool that
hands a whole topic to its own short `runAgentLoop` (`mode: 'ask'`,
`maxSteps: 6`, only the six search tools — never `research_topic` itself, no
recursion). Key design point: **the sub-run shares the parent's
`RetrievalLedger`** (it calls the same `dispatch`), so everything it retrieves
is citable by the parent with `insert_footnote` — but it runs its own loop, so
the search excerpts never enter the parent's context. It returns a 2–4 sentence
synthesis plus the list of `{id, reference, excerpt}` it added, and a note
telling the model to cite by id and not call it again for that topic.

`RetrievalLedger` gains `list()`. `AgentSession` gains `model` (the active
provider's `ModelFn`, for the sub-loop) and `isCancelled`. `research_topic`
joins `CITABLE_SEARCH_TOOLS` (citation closure) and the drafting / fatwā /
tafsīr domain rules in `toolScoping.ts`.

## Consequences

- New: `electron/agent/journal.ts`; `buildResearchSubagentPrompt` in
  `systemPrompt.ts`; `research_topic` in the tool registry (25 tools).
  Tests: `agentJournal.test.ts`, `compactMessages` in `agentLoop.test.ts`,
  `research_topic` cases in `agentDispatch.test.ts`.
- `SystemPromptInput` gains `recentWork`; `AgentSession` gains `model` +
  `isCancelled`.
- Deferred: the reasoning-model critic step (a different Phase-C item).
