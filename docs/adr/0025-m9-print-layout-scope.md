# ADR 0025 — `typeset_print_ready` Produces a Print-Ready Word Layout, Not Press-Grade Typesetting

**Status:** Accepted · **Date:** 2026-09-05 · **Milestone:** SPEC-M9

## Context

Use case 12 ("پرنٹ ریڈی بک کمپوزنگ") asks for a press-ready book. The proposal's
language — gutter margins, waziri/royal trim, odd/even running heads — is
squarely a *page-layout* job, which Word does. But "press-ready" can also mean
InDesign-grade typesetting: optical kerning, ligature and small-caps tables,
justified line-breaking with real hyphenation dictionaries, PDF/X output. Word
does none of that, and EasyEditor is not going to bundle a typesetting engine.

## Decision

`typeset_print_ready` applies a **print-ready Word layout** and says so.

- `electron/adapters/word.ts` `setPrintLayout` (host op `setPrintLayout`, shipped
  in Phase 2) sets `PageSetup`: `PageWidth`/`PageHeight` from a named trim
  (`shared/print/trimSizes.ts` — a5, b5, 6×9, waziri, digest, or `custom`),
  `Gutter`, `MirrorMargins`, `OddAndEvenPagesHeaderFooter` with per-odd/even
  running-head text, `DifferentFirstPageHeaderFooter`, and — Phase 8 —
  `SectionStart = wdSectionNewOddPage` for a recto start.
- The tool's `description` states the scope in one sentence ("a print-ready WORD
  layout, NOT press-grade typesetting"), and **every call returns a `loss`
  list** (`PRINT_LAYOUT_LOSS`): no kerning/ligature tables, no true small caps,
  no PDF/X or spot colour; line-breaking, hyphenation and widow/orphan control
  are Word's own; embedded fonts must be licensed for embedding. The `/typeset-
  print` playbook's `guidance` repeats it. "Stated before it runs" (the plan's
  words) is realised as: the tool result and the artifact carry the loss list,
  and in Plan mode the scholar sees and approves the step first.
- The press PDF is `convert_document(to: 'pdf')` — Word's own PDF export, which
  is fine for a review proof and for many short-run presses, and is honestly
  labelled as such.

## Consequences

- No new typesetting dependency, no LaTeX/Prince/InDesign integration.
- `PRINT_LAYOUT_LOSS` is the single source of truth for what to tell the
  scholar; `agentTrimSizes.test.ts` pins it.
- `/synopsis-design` reuses `typeset_print_ready` at `trim: 'a5'` — a synopsis
  needs a tidy layout, not a press run.
