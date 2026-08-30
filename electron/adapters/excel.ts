/**
 * M8 Layer 2 — the Microsoft Excel adapter (SPEC-M8 §3 "Layer 2", P9).
 *
 * Same shape as electron/adapters/word.ts: a pure {@link AdapterDescriptor},
 * an `available()` probe, and operations implemented as op sequences over the
 * shared Layer 1 host — every path validated, every session serialised
 * through `runExclusive` (COM re-entrancy safety).
 */
import { logger } from '../lib/logger.js';
import { getWordHost, refreshOwnedExcel, runExclusive, detectTools } from '../host/index.js';
import type { ExcelReadSheetReply } from '../host/types.js';
import type {
  AdapterDescriptor,
  AdapterAvailability,
  SheetData,
} from '../../shared/adapters/types.js';
import { assertSafeOutputPath, assertReadableFile, type DocExt } from './paths.js';

const log = logger.child('adapters/excel');

/** What Excel's `Workbooks.Open` can load as a source. */
const OPENABLE: DocExt[] = ['.xlsx', '.xls', '.csv'];

export const excelDescriptor: AdapterDescriptor = {
  id: 'excel',
  label: 'Microsoft Excel',
  reads: [
    { format: 'xlsx', quality: 1 },
    { format: 'csv', quality: 0.75, lossy: 'Only cell values — formulas, formatting, and every sheet but the first are not in a CSV.' },
  ],
  writes: [
    { format: 'xlsx', quality: 1 },
    { format: 'pdf', quality: 0.9, lossy: 'A static page rendering; the workbook is no longer editable.' },
    { format: 'csv', quality: 0.6, lossy: 'One sheet, values only — formulas, formatting, and other sheets are dropped.' },
  ],
  ops: ['exportSpreadsheet', 'readSheet'],
  platforms: ['win32'],
};

/** Whether Excel automation works on this machine right now. */
export function available(): AdapterAvailability {
  const t = detectTools();
  return t.excel
    ? { available: true, version: t.excelVersion ?? null }
    : { available: false, version: null, reason: 'Microsoft Excel is not available.' };
}

const EXT_FOR: Record<'xlsx' | 'csv' | 'pdf', DocExt> = { xlsx: '.xlsx', csv: '.csv', pdf: '.pdf' };

/** `.xlsx`/`.xls`/`.csv` → xlsx / csv / pdf via Excel's own SaveAs / export. */
export async function exportSpreadsheet(
  sourcePath: string,
  to: 'xlsx' | 'csv' | 'pdf',
  outputPath: string,
): Promise<{ outputPath: string; ms: number }> {
  const src = assertReadableFile(sourcePath, OPENABLE);
  const out = assertSafeOutputPath(outputPath, [EXT_FOR[to]]);
  const started = Date.now();
  await runExclusive(async () => {
    const h = getWordHost();
    await h.sendOk({ op: 'excelOpen', path: src });
    await refreshOwnedExcel();
    await h.sendOk({ op: 'excelExport', path: out, format: to });
    await h.sendOk({ op: 'excelClose' });
  });
  log.debug('exportSpreadsheet', { to, out });
  return { outputPath: out, ms: Date.now() - started };
}

/** Read a sheet's used range (capped) — the `.xlsx` → EasyEditor inspection side. */
export async function readSheet(
  sourcePath: string,
  opts: { sheet?: string; maxRows?: number; maxCols?: number } = {},
): Promise<SheetData> {
  const src = assertReadableFile(sourcePath, OPENABLE);
  return runExclusive(async () => {
    const h = getWordHost();
    await h.sendOk({ op: 'excelOpen', path: src });
    await refreshOwnedExcel();
    try {
      const r = await h.sendOk<ExcelReadSheetReply>({
        op: 'excelReadSheet',
        sheet: opts.sheet,
        maxRows: opts.maxRows,
        maxCols: opts.maxCols,
      });
      return {
        sheet: r.sheet,
        sheets: r.sheets ?? [],
        rows: r.rows ?? [],
        truncated: r.truncated ?? false,
      };
    } finally {
      await h.send({ op: 'excelClose' });
    }
  });
}
