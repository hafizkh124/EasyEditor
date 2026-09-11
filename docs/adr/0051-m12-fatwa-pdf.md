# ADR 0051 — Fatwā PDF via Word COM (No PDF Library)

**Status:** Accepted · **Date:** 2026-09-11 · **Milestone:** M12 (Phase E) · **Extends:** [ADR-0021](./0021-m9-bounded-generative-tools.md), [ADR-0048](./0048-m11-excel-write-zakat.md), [ADR-0050](./0050-m12-excel-write-fix.md)

## Context

Phase B/C gave zakat/farā'iḍ answers a computed table and a non-fatwā
disclaimer; scholars asking for a formal, signed fatwā still had no path to
one. No PDF library exists in this project (ADR-0048's own precedent — Excel
export goes through Word/Excel COM, never a library), so the same constraint
applies here: build a `.docx`, export it to PDF through Word's own
`ExportAsFixedFormat`, exactly like `convert_document`/`typeset_print_ready`
already do.

The harder question was WHERE the boundary between "deterministic code" and
"model-written prose" sits inside one fatwā document. ADR-0048's rule — the
model never does the arithmetic — extends naturally to "the model never
RE-TYPES the arithmetic either": a transcribed figure that drifts by one
digit from the real calculation is exactly the failure mode ADR-0048 exists
to prevent.

## Decisions

**The fatwā document is a deterministic HTML shell around a model-written
ruling, not a model-written document.** `shared/print/fatwaTemplate.ts`
(pure, no runtime globals) builds bismillah + a plain letterhead + the
scholar's own verbatim question + an OPTIONAL results table + the ruling
prose + the compute engine's own disclaimer + signature lines, as one HTML
fragment. `resolveResultTable()` sniffs a parsed JSON value into a table:
a plain `{columns, rows}` shape, a `ZakatResult` (`zakatDue` present), or a
`FaraidResult` (`asl` present) — every figure that reaches the page comes
from this sniffing of the compute engine's own output, never from a model
retelling it. `resolveDisclaimer()` pulls the engine's own `note` the same
way.

**`draft_section` gains `mode: 'fatwa'`**, fitting ADR-0021's closed-template
shape: the model is instructed to write ONLY the ruling/evidence discussion
(explicitly told not to restate any figures — "a transcribed figure that
drifts from the real one is a serious error"), never the whole document.
`dispatch.ts`'s `draft_section` case then wraps that prose in
`buildFatwaHtml()` before writing it — `question` is required for this mode;
`result_json` (the EXACT JSON a prior `calculate_zakat`/`calculate_faraid`
call returned, copied through — the same trust boundary `insert_footnote`'s
`claim` field already relies on) and `mufti_names`/`institute_name` are
optional. `result_json` is parsed and validated BEFORE the model call, so a
malformed value fails fast without spending it. Both `dispatch.ts` (desktop)
and `webDispatch.ts` (web) implement this identically — `fatwaTemplate.ts` is
pure, so web gets full parity, same as the Phase C/D engines.

**No PDF library, no binary letterhead file.** The wrapped HTML goes through
the SAME HTML→`.docx` path `draft_section` already uses
(`word.ts`'s `applyTextTask`, tmpdir HTML→docx); `convert_document(to:'pdf')`
(existing `exportAs`/`ExportAsFixedFormat` op) produces the PDF. Since Word's
HTML import does not see an external `<style>` block (the body fragment is
wrapped in a fixed `<head>`), every visual property in `fatwaTemplate.ts` is
an INLINE style, not a CSS class. The letterhead itself ships as an inline
HTML block (a heading + a rule), not a `.dotx` file — `install_template` /
`attachTemplate` remain available unchanged for a scholar who wants their own
letterhead template attached on top.

**`shared/print/layoutPresets.ts` (M11 Phase 4, shipped but never called from
anywhere) is wired in.** `typeset_print_ready` gains a `preset` param
(`a4-essay` / `a5-booklet` / `waziri` / `digest` / `fatwa`) that resolves
trim + margins + gutter + line spacing + header in one choice; an explicit
individual override (`margin_top_cm`, `gutter_cm`, …) still wins over the
preset's own value for that one field. This also surfaced and fixed a
second, deeper half-wired bug: `wordBridge.ps1`'s `setPrintLayout` op has
read `marginTopCm`/`marginBottomCm`/`marginLeftCm`/`marginRightCm`/
`lineSpacingPt` since M11 Phase 4, but NEITHER `electron/host/types.ts`'s
`HostCommand` type NOR `electron/adapters/word.ts`'s `PrintLayoutOptions`
ever carried them — no caller could have sent them even by hand. Both are
now extended. The `fatwa` preset itself is a clean rewrite of the old
`fatwa-pad` entry, which carried a placeholder `headerOdd: ".Fatwa"` value
that was never a real header string.

**The zakat/farā'iḍ and `shariah-fatwa` playbooks now produce a finished PDF
end to end.** Each gains, after its `calculate_*`/evidence steps: a
`draft_section(mode:'fatwa')` step (seeding `mode` and binding
`question`/`result_json` — `shariah-fatwa` has no calculation, so it omits
`result_json`), then `typeset_print_ready(preset:'fatwa')`, then
`convert_document(to:'pdf')` — all three optional, so a scholar who only
wants the answer in-chat still gets one. `thesis-university-format` also
gains a `typeset_print_ready(preset:'a4-essay')` step alongside its existing
`set_page_layout` (which only sets RTL reading order, never margins — the two
ops are complementary, not interchangeable).

## Consequences

- New: `shared/print/fatwaTemplate.ts` (`buildFatwaHtml`, `resolveResultTable`,
  `resolveDisclaimer`, `tableFromZakatResult`, `tableFromFaraidResult`).
- `shared/ai/prompts/draftSection.ts`: `DraftMode` gains `'fatwa'`;
  `buildDraftInput` gains an optional `question` context line.
- `shared/agent/toolSchemas.ts`: `draft_section` gains `question`,
  `result_json`, `mufti_names`, `institute_name`; `typeset_print_ready` gains
  `preset`, `margin_top_cm`, `margin_bottom_cm`, `margin_left_cm`,
  `margin_right_cm`, `line_spacing_pt`, and its `required` drops `trim`
  (either `trim` or `preset` now satisfies the layout choice).
- `dispatch.ts` + `webDispatch.ts`: `draft_section`'s fatwa-mode wrapping;
  `typeset_print_ready`'s preset resolution (desktop only — this tool stays
  in `NATIVE_ONLY_TOOLS`, unaffected by this change).
- `electron/adapters/word.ts` (`PrintLayoutOptions`) and
  `electron/host/types.ts` (`HostCommand`'s `setPrintLayout` variant) extended
  with the 5 margin/line-spacing fields `wordBridge.ps1` already accepted.
- `shared/print/layoutPresets.ts`: `fatwa-pad` → `fatwa` (rewritten, the
  `.Fatwa` placeholder removed).
- `shared/playbooks/registry.ts`: `zakat-assessment-workflow`,
  `faraid-fatwa-workflow`, `shariah-fatwa` gain the fatwa/layout/PDF steps;
  `thesis-university-format` gains the `a4-essay` layout step.
- Tests: `fatwaTemplate.test.ts` (18 — structure, escaping, the
  table-sniffing contract), `layoutPresets.test.ts` (7 — preset value
  invariants, `resolveLayoutPreset` degrading cleanly on an unknown id);
  `agentDispatch.test.ts` / `webDispatch.test.ts` additions for
  `draft_section` mode `'fatwa'` and `typeset_print_ready`'s `preset`.
- Not yet live-verified against real Word COM (same open item as ADR-0050
  for Excel) — the HTML→docx→PDF chain and the new `setPrintLayout` margin
  fields are unexercised against a real Word instance.
