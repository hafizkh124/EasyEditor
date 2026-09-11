# ADR 0050 — `build_spreadsheet` Fixed: Multi-Sheet, Live Formulas, RTL, One COM Session

**Status:** Accepted · **Date:** 2026-09-11 · **Milestone:** M12 (Phase D) · **Extends:** [ADR-0048](./0048-m11-excel-write-zakat.md)

## Context

The M11 Phase 4 `build_spreadsheet` tool was never actually exercised end to
end (`excelAdapter.test.ts` covered only the pre-existing read/export paths).
The M12 planning audit found it genuinely broken in four ways:

1. **Multi-sheet was silently impossible.** `writeRange(path, data, {sheet})`
   opens the workbook and does `Worksheets.Item(name)` — but a freshly
   created workbook has exactly ONE default sheet, so any sheet name beyond
   the first threw "subscript out of range".
2. **`setFormula` and `formatCells` were entirely orphaned** — `dispatch.ts`'s
   `build_spreadsheet` case never called either, so `sheets[].formulas`/
   `sheets[].format` had no effect even if a caller supplied them (the tool
   schema did not even expose those fields).
3. **`format: 'pdf'`/`'csv'` threw before the export step.** `createSpreadsheet`
   validated the OUTPUT path's extension against `.xlsx` only
   (`assertSafeOutputPath(outputPath, ['.xlsx'])`), even when the caller asked
   for a `.pdf`/`.csv` file — the whole call failed before Excel ever ran.
4. **Every write was its own full COM session.** `writeRange`/`setFormula`/
   `formatCells` each independently did open → mutate → SaveAs → close — N
   sheets meant N such round trips against the same file.
5. **No RTL support at all** for an Urdu/Arabic sheet (Nastaʿlīq font,
   right-to-left reading order).

Also, `sheets` in the tool schema was `{ type: 'array' }` with no `items` —
`ToolParam` cannot express an array of rich objects at all, so this never
validly described its own shape.

## Decisions

**One batched COM session per build.** `wordBridge.ps1` gains `excelAddSheet`
(`Worksheets.Add()` after the last sheet, optionally renamed),
`excelRenameSheet`, and `excelBatch` (runs an array of
add-sheet/write/formula/format sub-commands against the ALREADY-OPEN
workbook, one message). The four sheet-building ops (`excelAddSheet`,
`excelWriteRange`, `excelSetFormula`, `excelFormat`) share ONE PowerShell
implementation (`Invoke-ExcelSubCommand`) so the standalone-op and
inside-a-batch code paths cannot drift apart. `electron/adapters/excel.ts`
gains `buildWorkbook(outputPath, sheets, opts)`: one `excelCreate` →
one `excelBatch` (every sheet's data/formulas/formatting) → export → close.
The first `SheetSpec` renames the workbook's own default sheet; every other
one is added — this is also the multi-sheet bug's fix (no sheet name has to
already exist).

**The build target is never the requested final format.** `buildWorkbook`
always builds at an intermediate `.xlsx` path (live formulas only make sense
in Excel's own format) and, when the caller wants `pdf`/`csv`, runs a SECOND
`excelExport` to the real target and deletes the intermediate. This is the
direct fix for the format-vs-extension-validation bug — the `.xlsx` check now
only ever runs against a path that is actually `.xlsx`.

**Formulas travel in A1 notation.** `excelSetFormula` accepts `cell: "C9"`
(preferred) as an alternative to `row`/`col` ints — the natural way to write
`"=SUM(B2:B8)"` or `"=C9*0.025"` without any row/column arithmetic on the
caller's side.

**RTL is a per-format-call flag, not a separate tool.** `excelFormat` (and so
`excelBatch`) accepts `rtl?: boolean` (sets the worksheet's own
`DisplayRightToLeft` plus the range's `ReadingOrder`, `xlRTL = -5004` /
`xlLTR = -5001`) and `fontName?: string`. A new `Resolve-FontName` helper
(reusing `System.Drawing.Text.InstalledFontCollection`, already an accepted
dependency here for `installFont`) picks the preferred face if installed,
falls back to Amiri, and otherwise hands the name through as-is — Excel
itself never errors on an unknown `Font.Name`, it just substitutes for
display, so this never throws.

**`build_spreadsheet`'s `sheets` param becomes a JSON string**, matching the
Phase C pattern (`calculate_zakat`/`calculate_faraid`) established for
exactly this reason: `ToolParam` cannot express a nested object. This is a
wire-contract change, not a compatibility break — the tool never worked for
anything beyond a single flat sheet before this fix.

**A deterministic "turn this into a spreadsheet" chip.** `shared/agent/
recommendations.ts` gains a `build-spreadsheet` action, offered after
`calculate_zakat`/`calculate_faraid` in a write-capable run once
`build_spreadsheet` has not already been called — closing the ADR-0049
"export chips deferred until the table→file path exists" gap, at least for
xlsx (PNG/copy-table stay deferred, M12 Phase F).

## Consequences

- New PowerShell ops: `excelAddSheet`, `excelRenameSheet`, `excelBatch`;
  `excelSetFormula`/`excelFormat` extended (`cell`, `rtl`, `fontName`); shared
  `Invoke-ExcelSubCommand` + `Resolve-FontName` helpers.
- New: `electron/adapters/excel.ts` `addSheet()`, `buildWorkbook()`,
  `SheetSpec`; `electron/host/types.ts` `ExcelSheetSubCommand`,
  `ExcelAddSheetReply`, `ExcelBatchReply`; `shared/adapters/types.ts`
  `AdapterOp` gains `'addSheet' | 'buildWorkbook'`.
- `dispatch.ts`'s `build_spreadsheet` case rewritten around `buildWorkbook`;
  `toolSchemas.ts`'s `sheets` param is now a JSON string.
- Tests: `excelAdapter.test.ts` (+16 — op sequencing, sheet-rename-vs-add,
  formula/format pass-through, the pdf-path build/export/cleanup sequence,
  format inferred from the output extension); `agentDispatch.test.ts` (+5 —
  JSON parsing/validation, the format:'pdf' regression case);
  `agentRecommendations.test.ts` (+1 — the new chip's gating).
- **Not yet live-verified against real Excel COM.** `hostLive.test.ts`'s
  opt-in `DOC_BRIDGE_LIVE=1` suite still only exercises the pre-existing
  `readSheet`/`exportSpreadsheet` paths; this ADR's new ops (`excelAddSheet`,
  `excelBatch`, RTL/font resolution) are unexercised against a real Excel
  instance — recommend a live smoke test before relying on this in
  production, per the M9 precedent where a live run caught 2 real COM bugs
  that mocked tests could not.
