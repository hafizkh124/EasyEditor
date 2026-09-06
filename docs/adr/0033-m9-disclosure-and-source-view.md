# ADR 0033 — AI-Disclosure Ledger and Open-Before-Accept Source View

**Status:** Accepted · **Date:** 2026-09-06 · **Milestone:** SPEC-M9 (blueprint §3, optional items)

## Context

The blueprint review (plan §3) listed two 2026-practice items that were never
scheduled into the A–E roadmap but are cheap and worth having:

1. An **AI-disclosure ledger** — evolving APA/MLA/Chicago norms ask an author to
   disclose where a manuscript used AI assistance. EasyEditor already knows this
   precisely (every `draft_section` / substantive `run_task` write).
2. **One-click "open the source passage"** before the scholar accepts a citation
   tracked change — the footnote rests on a retrieved excerpt the scholar never
   actually sees; it lives only in the tool-result JSON.

## Decisions

### AI-disclosure ledger

**Deterministic recording, no model call.** `electron/agent/disclosure.ts`
`digestDisclosure(result, provider, model)` pulls the drafting / rewriting acts
out of a finished run — `draft_section` (any mode) and `run_task` whose slug is
in `DISCLOSED_TASKS` (the six substantive passes: paraphrase, summarize,
summarize_sections, shorten, formalize, humanize). The mechanical passes
(harakat, spelling, script, auto-format) are **not** disclosed, for the same
reason a spell-checker is not. `run.ts` `finish()` appends one JSONL line per
act to `.easyeditor/ai-disclosure.jsonl` (bounded 500 lines, corrupt line
skipped), attributed to the **text** provider (`getTextProviderId()` — the one
that generated the prose, which may differ from the loop provider).

**The statement is built, not generated.** `shared/agent/disclosure.ts`
`buildDisclosureStatement(entries, { projectTitle? })` is pure and
deterministic: it groups by chapter, separates drafting from rewriting, lists
each distinct provider/model and the date range, and emits a **bilingual
(Urdu + English)** markdown statement. It states plainly that every recorded
change landed as a tracked change the scholar accepted or rejected, and that it
is a factual record — not legal or journal-policy advice.

**The `compile_ai_disclosure` tool** (effect: `write`) reads the ledger and
writes `AI-DISCLOSURE.md` to the project root for the scholar to review, edit,
and place in the front matter — plus an artifact card. Empty ledger ⇒ "no
disclosure is needed", nothing written. It joins a new `disclosure` domain rule
in `toolScoping.ts`.

### Open-before-accept source view

`insert_footnote` now **emits a `citation-list` artifact** after the tracked
change lands: one entry carrying the resolved chunk's `reference`, `sourceId`,
`tier`, the claim-check `supported` flag, the source `url`, **the retrieved
excerpt**, and the `claim` — closed with `targetChapter`. The
`AgentArtifactEvent` `citations` entry and `ArtifactCitationEntry` gain
`excerpt?` and `claim?`; `query_tafseer` and `research_topic` pass `excerpt`
too (they already have the content).

`AgentArtifactPanel` renders a citation entry with an excerpt / claim / url as a
`<details>` disclosure: the reference line stays the summary, expanding shows
the claim, the source passage as a blockquote, and — mirroring
`SourceCardList` — a plain `target="_blank" rel="noopener noreferrer"` link to
the original. So before the scholar switches to Word to accept the footnote's
tracked change, they can read exactly what it rests on.

## Consequences

- New: `shared/agent/disclosure.ts`, `electron/agent/disclosure.ts`,
  `docs/adr/0033-*`. Tests: `agentDisclosure.test.ts`, plus cases in
  `agentDispatch.test.ts` and `agentArtifacts.test.ts`.
- `compile_ai_disclosure` joins the tool registry (29 tools) and a new
  `disclosure` domain rule.
- `AgentArtifactEvent`/`ArtifactCitationEntry` gain `excerpt?` + `claim?`;
  two new locale keys (`agent.artifact_claim`, `agent.artifact_open_source`).
- `run.ts` `finish()` writes the disclosure ledger next to the journal line;
  `taskWrote()` and `labelFor()` learn the new tool.
- Both items are opt-in in spirit: the ledger is derived/disposable, and the
  statement only ever reports what was recorded — it never invents an entry.
