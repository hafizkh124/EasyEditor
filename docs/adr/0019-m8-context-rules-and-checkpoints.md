# ADR 0019 — Context Tagging, Project Rules, Task Checkpoints — and What Was Deliberately Not Adopted

**Status:** Accepted · **Date:** 2026-08-29 · **Milestone:** SPEC-M8

> **Implementation (2026-08-30):** all of this ADR's decisions are now shipped
> — `@` mentions (chapters + document outline + Shamela books), `قواعد.md`
> rules, task checkpoints + "Undo this task", the two-tier `insert_footnote`
> check, `check_consistency` as a lexical search, one-task-at-a-time, and the
> consent-gated global-option flow (§3 gate #5). Item 7 ("no open Browser
> tool") is realised as the renderer-bridged `search_general`: it routes
> through the existing signed-in `research-query` channel and its answer is
> never added to the citation ledger.

## Context

Mid-design, two rounds of secondary research were brought in: a survey of
Cursor/Windsurf-style coding-IDE conveniences (`@` mentions, inline diff
review, a project-rules file, checkpoints/rollback), and a deeper survey of
four production agentic platforms (Claude Code, OpenAI Canvas/Codex, Google
Antigravity, Augment Code/Aider) and the architectural patterns behind each.
Both surveys proposed real, well-known patterns; neither was written with
this codebase's actual constraints in view (COM automation's re-entrancy
limits, the existing Trust UI's provenance guarantees, the existing BYOK
scope). Each proposal needed to be checked against SPEC-M8's own decisions
rather than adopted wholesale — some genuinely closed real gaps in the
draft; several were already covered by existing EasyEditor features
misdescribed as missing; others carried real costs (money, reliability,
architectural surface area) disproportionate to what they'd buy here.

## Decision — adopted

1. **`@` mentions (`shared/mentions/`).** Typing `@` in the Agent chat
   surfaces the project's chapters, Shamela books, and outline. This is not
   a new tool — it's a UI path that supplies an explicit file path / book id
   to the existing `search_corpus`/`search_shamela`/`word.*` commands, so
   the agent doesn't have to guess which file "@Ihya_Ulum-al-Din" refers to.
2. **Project rules (`قواعد.md`)**, at the project folder's root, human-
   written and human-readable: font, footnote style, maximum quotation
   length, and similar standing constraints. Injected into every agent
   call's system prompt (`shared/agent/systemPrompt.ts`). Distinct from a
   playbook: a playbook is a procedure ("how to do this task"); rules are a
   constraint ("what always holds"). A missing file is silently ignored,
   never required.
3. **A `/` command picker** in the Agent chat box, reusing the existing
   `CommandPalette.tsx` pattern, to select a playbook or specific tool
   command directly instead of writing a long prompt.
4. **Live, step-by-step progress** in the Agent chat ("reading the file…
   searching Shamela… inserting the footnote…") — a UI requirement, not
   decoration; see SPEC-M8 §3 Layer 6.
5. **Task-level checkpoints.** Each agent *task*'s writes are grouped as one
   unit in `.easyeditor/history/`; one "Undo this task" button reverts the
   whole group. Distinct from the per-write backup that already exists for
   corruption recovery (SPEC-M8 §3, security gate 3) — this one exists so a
   researcher can walk back a bad multi-step task without thinking about
   which individual writes belong to it.
6. **A two-tier check inside `insert_footnote`**: a deterministic integrity
   gate (does the citation resolve to a real retrieved chunk at all), plus
   an optional lightweight claim-verification pass (does the excerpt
   actually support the paragraph's claim) — both inside the one existing
   tool call.
7. **`search_general`**, a new tool routed through the existing "General"
   research mode's edge function, carrying the same `TaskRunSource.channels`/
   `domain` tagging every other Trust UI source already carries.
8. **Consistency nudges** (SPEC-M8 §3, Layer 7, P5): a lexical
   `search_corpus` lookup across the project's other chapters when a term or
   citation changes, surfaced as a suggestion, never applied automatically.

Items 1–5 were also independently proposed by the first (Cursor/Windsurf)
survey; the second survey's overlapping claims (inline single-paragraph
edit, quick-action toggles) turned out to already exist in EasyEditor as the
bubble menu and the 12 built-in tasks (README) — restated as if new, not
actually a gap.

## Decision — explicitly rejected, with reasons

1. **A literal multi-agent Planner/Executor/Verifier pipeline** (as in one
   platform's architecture). Every additional agent is another model call;
   for citation integrity specifically, the two-tier check inside
   `insert_footnote` (item 6, above) gets the same guarantee at a fraction
   of the cost, without a second architecture to maintain.
2. **Stuffing 5–10 whole source books into the model's context at once.**
   The existing RAG/vector search (`search_corpus`) already gives
   page/volume-precise retrieval, which is what citation-grade sourcing
   actually needs, and scales to far more than 10 books — raw context
   stuffing does neither.
3. **A literal "dependency graph"** between chapters, modeled on a code
   compiler's import graph. Prose does not have a function/import
   relationship for a graph to represent; the adopted alternative (item 8,
   above) is a plain lexical search, correctly described as such rather
   than dressed up as a graph data structure.
4. **An open "Browser" / raw web-search tool.** EasyEditor's Trust UI and
   the credibility work in `STRATEGY-v1.md` depend on every source being
   graded and channel-tagged (Dorar, Sunnah.com, the personal corpus,
   Shamela). An unrestricted browsing tool would let the agent cite
   anything on the open web with no provenance guarantee. `search_general`
   (adopted, item 7) gets equivalent reach through the channel that already
   carries that guarantee.
5. **A desktop model picker / multi-provider BYOK.** Desktop BYOK stays
   Gemini-only for SPEC-M8. Supporting multiple model providers is a
   separate, larger decision — per-provider key storage, and tool-calling
   behavior that differs meaningfully provider to provider — not something
   that falls out of this work for free.
6. **True background/parallel agent tasks** (e.g., two chapters being edited
   by the agent simultaneously in separate tabs). COM automation is not
   safely re-entrant across simultaneous calls against the same
   `Application` instance; SPEC-M8 runs one agent task at a time, queuing a
   second rather than risking a collision. Revisiting this would require a
   per-adapter serialization/queue layer that does not exist yet — a
   separate piece of work, not a default assumption.

## Consequences

- Any future proposal that resembles one of the six rejected items above
  should be checked against this ADR's stated reasons before being
  reconsidered, not re-adopted by default because a well-known tool does it
  that way.
- `search_general`'s channel/domain tagging is now a hard requirement,
  enforced by `searchGeneralChannel.test.ts` (SPEC-M8 §9) — a result without
  that metadata must never reach the UI.
- The single-agent-task-at-a-time constraint (item 6, rejected) is a stated
  limitation surfaced in the UI (a visible queue), not a silent
  restriction — see SPEC-M8 §3 Layer 6 and `taskQueue.test.ts`.
