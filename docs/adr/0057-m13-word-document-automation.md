# ADR 0057 — `automate_word_document`: tables, script-aware fonts, page setup, find & replace, page numbers

**Status:** Accepted · **Date:** 2026-09-29 · **Milestone:** M13 Scholar Desktop Agent · **Extends:** [ADR-0017](./0017-m8-adapter-platform.md), [ADR-0025](./0025-m9-print-layout-scope.md), [ADR-0056](./0056-m13-outside-project-file-edits.md)

## Context

The Word bridge could footnote, comment, compare, index and lay out a book,
but not insert a table, set a font, flip orientation, or find-and-replace —
the everyday requests in the M13 blueprint. Tashkeel was also asked for as a
COM op; it already exists as `run_task harakat` (model rewrite → Word Compare
→ tracked changes), which is reviewable and stays the way to do it.

## Decision

- **One tool, a batch of ops, one Word session.** `automate_word_document`
  takes `ops` as a JSON-encoded array (max 10) — `ToolParam` cannot express
  nested objects, same convention as `build_spreadsheet`. `shared/agent/
  wordAutomation.ts` parses, validates and normalises every op BEFORE Word
  is touched (unknown op, >15 columns / >300 rows, font names with quotes or
  newlines, `find` > 255 chars, out-of-range page sizes → a correctable
  error), and renders one Urdu line per op for the approval card.
- **New bridge ops** (`wordBridge.ps1`): `insertTable` (bordered, header row
  bold + repeating, `TableDirection = 0` = RTL), `setFonts` (styles Normal /
  Heading 1–3 / Footnote Text get the base Arabic-script font via `NameBi`;
  when both an Urdu and an Arabic font are named, paragraphs containing
  Urdu-only letters ٹ ڈ ڑ ں ھ ہ ے ۓ get the Urdu font; fonts not installed →
  soft refusal listing `missingFonts`, nothing changed), `setPageSetup`
  (orientation first, then the already-oriented width/height; paper presets
  A4/A5/B5/Letter/Legal/Royal/وزيري/digest), `findReplace`, and
  `insertPageNumbers` (numeral style 0 = 1 2 3, 51 = ١ ٢ ٣).
- **`findReplace` counts first, then uses Word's own ReplaceAll.** The first
  version replaced hit-by-hit and **looped forever live**: with Track Changes
  on, the deleted text stays in the story, and Arabic alef-hamza-insensitive
  matching made the inserted «الاعمال» match «الأعمال» again. Over the cap
  (default 2000) → no change, `capped: true`. The Arabic match switches
  (`MatchDiacritics` / `MatchKashida` / `MatchAlefHamza`) are only set when
  the model passes them, so Word's defaults apply otherwise.
- **Per-op timeouts** (`OP_TIMEOUT_MS`) — the host kills itself on a timeout,
  so `automateDocument` marks the remaining ops "skipped" and throws rather
  than sending into a dead session.
- **Live-verified** against Word 16.0 (`hostLive.test.ts`, M13 block), with an
  independent COM readback: table 3×3 RTL, Urdu/Arabic paragraph fonts,
  landscape 842 pt, 15 tracked revisions, page numbers style 51.

## Consequences

- `set_page_layout` / `typeset_print_ready` keep margins, gutter and book
  trim; this tool deliberately does not duplicate them.
- `setFonts` direct-formats paragraphs only when two Arabic-script fonts must
  be distinguished; otherwise it is a style change.
