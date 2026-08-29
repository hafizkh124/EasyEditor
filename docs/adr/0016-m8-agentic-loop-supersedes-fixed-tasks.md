# ADR 0016 — Agentic Loop Supersedes "The Model Never Chooses the Steps"

**Status:** Accepted · **Date:** 2026-08-29 · **Milestone:** SPEC-M8 (was drafted as "M7"; see SPEC-M8 §0)

## Context

The README and `SPEC-M4.md` establish a deliberate product principle: *"The
model never chooses the steps"* — the AI Task Library ships 12 fixed
built-in tasks and Recipes are fixed multi-step pipelines; there is no
free-form prompt box. This was a considered choice against hallucinated
academic content and unpredictable AI behavior in a scholarly tool.

SPEC-M8 asks the agent to drive external tools (Word, InPage, LibreOffice,
Shamela) end-to-end from a single natural-language instruction — "open
chapter two, fix the al-Ghazali citation, produce a Word file in university
format." That instruction cannot be satisfied by selecting one fixed task; it
requires the model to sequence multiple tool calls (`read_docx` →
`search_corpus` → `insert_footnote` → `set_page_layout` → `export_document`)
and decide the order and count of steps at runtime. This is a direct reversal
of the stated principle, and it must not happen silently.

## Decision

The principle is superseded, **only** inside the new Agent tab
(`WorkbenchPanel.tsx`, gated by `isDesktop()` + `VITE_AGENT_MODE`), with four
compensating controls that did not exist when the original principle was
written:

1. **The agent's vocabulary is still closed.** It does not write free-form
   prose into the model's tool-use loop as "the task" — it selects from a
   fixed registry of tool calls and playbooks (SPEC-M8 §3, Layer 4 and 6).
   The 12 built-in tasks and their bubble-menu/slash-menu entry points are
   unchanged and remain the free-prompt-free path for everyone who doesn't
   open the Agent tab.
2. **Every text change is a tracked change**, never a direct overwrite
   (`Document.TrackRevisions = true`). The researcher accepts or rejects
   each one, in Word or in the app's own canvas view.
3. **Citations are gated, not generated.** `insert_footnote` only succeeds
   when the citation resolves to a real retrieved chunk (book, volume,
   page); an unsupported claim gets an error, not an invented footnote.
4. **The full transcript is recorded** in `task_runs` and surfaced in the
   Trust tab — every tool call, every source, exactly as the existing
   single-task runs already are.

## Consequences

- The Agent tab is the one place in the app where a researcher can trigger
  an open-ended, multi-step AI-driven sequence. Everywhere else in the app,
  the original principle still holds unchanged.
- `docs/SPEC-M4.md` and the README should be read alongside this ADR, not
  edited to remove the original language — the principle still describes
  the rest of the product; this ADR documents the one deliberate exception
  and why it's safe.
- Any future feature that wants to relax "the model never chooses the
  steps" elsewhere in the app must justify itself against the same four
  controls, or add new ones — this ADR is not a blanket license.
