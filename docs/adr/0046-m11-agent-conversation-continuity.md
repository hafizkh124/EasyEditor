# ADR 0046 — Agent Conversation Continuity

**Status:** Accepted · **Date:** 2026-09-10 · **Milestone:** M11 (Phase 1) · **Extends:** [ADR-0032](./0032-m9-session-memory.md)

## Context

`agent.run()` was memory-less at the *conversation* level, and the renderer
made it worse:

- `runAgentLoop` (`shared/agent/loop.ts`) seeded `messages` with only the
  current instruction and discarded the transcript on return.
- `ResearchPanel.tsx` hard-coded `messages={[]}` for the agent branch, so the
  user's own question vanished the moment they hit send.
- `useAgentRun.send()` wiped `progress` / `result` / `artifacts` on every send.
- The only continuity was ADR-0032's per-project **journal** (a prose digest of
  past *tasks*, desktop-only) and a depth-1 string-concat hack
  (`pendingClarification`) for the `needs-input` case.

Net effect: a follow-up like "open the third point in that" reached the model
with no idea what "that" was. The user asked for Claude/Cursor-style threaded
context.

## Decisions

**The loop takes prior turns.** `AgentRunOptions` gains `history?:
AgentMessage[]`; `loop.ts` prepends it to `messages`. Absent = a cold run,
exactly as before.

**History is `user` / `model` text only — never tool traffic.** New pure module
`shared/agent/history.ts`: `buildHistory(turns)` maps `{instruction, answer}[]`
to `AgentMessage[]`, emitting **only** `role: 'user'` and plain-text
`role: 'model'` messages. The wire formats
(`openAiCompatWire.toOpenAiMessages`, `geminiTools.toContents`) pair each `tool`
message with the `tool_call` id of the assistant message right before it; a
prior-run `tool` message without that pairing makes strict OpenAI-compatible
providers return HTTP 400. The model still sees what it *concluded* last turn,
just not the raw plumbing. Recent turns are kept near-verbatim (answer capped at
1500 chars); older ones collapse to a one-line stub, mirroring
`loop.ts`'s own `stubToolResult`.

**The renderer keeps the thread.** `useAgentRun` gains `turns: AgentTurn[]`.
`send()` no longer wipes the previous run — it folds the finished run into
`turns` on the *next* send (so the most recent run keeps its full interactive
card: plan approval, consent, undo), and passes `buildHistory(...)`-shaped
`{instruction, answer}` pairs to the engine. A `needs-input` run contributes its
clarifying question as the "answer". This replaces `pendingClarification`
entirely.

**`ChatDisplay` renders finished turns.** New `ListItem` kind `agent_turn`
(question bubble + compact answer + provenance chips), rendered before the
singleton `agent_run` card. The flat-path auto-scroll is now
near-bottom-gated so scrolling up to re-read an earlier turn is not yanked down.

**Playbooks skip history.** A `/trigger` flow is self-contained; `run.ts` passes
`history` only to the direct-answer and free-loop paths.

**The journal stays — as a complement, not a substitute.** `turns` = *this
session's* thread; the journal = *what happened on this project across
sessions*. ADR-0032's journal was also under-rendering: `summary` and `sources`
were written to every entry but never reached the prompt — `formatJournalForPrompt`
now includes them.

## Consequences

- New: `shared/agent/history.ts`; `AgentRunOptions.history`;
  `AgentRunInput.history` (`ConversationTurn[]`); `agent.run`'s 5th arg; the
  `agent_turn` timeline item; `useAgentRun`'s `turns` / `clearConversation`.
- Removed: `pendingClarification` (the string-concat continuation hack). Its
  test in `agentPanel.test.tsx` now asserts the `history` mechanism instead.
- Tests: `agentHistory.test.ts` (7), `history` case in `agentLoop.test.ts`,
  multi-turn + `history` + "New chat" cases in `agentPanel.test.tsx`,
  `turns` in `chatDisplay.test.tsx`'s `agentView` fixture.
- Web parity: `useWebAgentEngine.run` takes `history` and calls `buildHistory`
  the same way. Web has no journal (unchanged — a separate follow-up).
- Deferred to M11 Phase 1b: persisting the conversation (session store +
  `?session=` restore + the History panel), and a turn-level budget helper for
  the unbounded research `chatHistory` path.
