# ADR 0048 — Excel Write Capability and Zakat Computation

**Status:** Accepted · **Date:** 2026-09-10 · **Milestone:** M11 (Phase 4) · **Extends:** [ADR-0049](./0049-m11-derived-agent-affordances.md)

## Context

Two output capabilities are missing from the agent: (1) writing data into Excel spreadsheets, and (2) computing zakat. Today `electron/adapters/excel.ts` can only read and export existing workbooks. No agent tool touches Excel at all. The zakat question is a common use case for the scholarly audience, but no calculation engine exists — the model would have to do arithmetic, which is unreliable.

## Decisions

**Excel write via PowerShell COM.** `wordBridge.ps1` gains four new operations: `excelCreate` (new workbook), `excelWriteRange` (write 2D arrays to cells), `excelSetFormula` (set cell formulas), `excelFormat` (bold, color, number format, auto-fit). The adapter (`electron/adapters/excel.ts`) grows corresponding ops. A new agent tool `build_spreadsheet` is registered in `toolSchemas.ts` and added to `NATIVE_ONLY_TOOLS` (requires Excel COM on desktop). The tool takes a file path and an array of sheets, each with a name and 2D data grid.

**Zakat is pure code, not a model call.** `shared/finance/zakat.ts` exports `calculateZakat(assets, liabilities, nisabPrice) → { amount, rate, nisabMet }`. Assets include cash, gold, silver, business inventory, and investments. Liabilities are debts due. The rate is 2.5% of net assets if above nisab. Gold/silver prices are user-provided (no live feed — wrong price = wrong fiqh result). The model only provides fiqh text and dalail; arithmetic is never delegated.

## Consequences

- New: `shared/finance/zakat.ts`, `build_spreadsheet` tool, 4 PowerShell ops, adapter expansion (~97 → ~250 lines).
- `NATIVE_ONLY_TOOLS` gains `build_spreadsheet`.
- `ArtifactToolbar.tsx` `isVisual` gate expands to include `table` type for PNG/xlsx export.
- Tests: `zakat.test.ts` (boundary cases), `excelWrite.test.ts` (mocked PowerShell bridge), `buildSpreadsheet.test.ts` (tool schema + dispatch).
