// @vitest-environment node
// electron/adapters/excel.ts — the Excel adapter (SPEC-M8 Layer 2 / P9).
// The Layer 1 host is mocked (hostLive.test.ts drives real Excel); this pins
// the op SEQUENCES, that paths are validated before any op is sent, and that
// every session goes through the exclusivity mutex.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { ToolAvailability } from '../../electron/host/types.ts';

const sent: Array<{ op: string; [k: string]: unknown }> = [];
const fakeHost = {
  sendOk: vi.fn(async (cmd: { op: string; [k: string]: unknown }) => {
    sent.push(cmd);
    switch (cmd.op) {
      case 'excelOpen': return { ok: true, op: cmd.op, name: 'book.xlsx', sheets: ['Sheet1', 'Data'] };
      case 'excelReadSheet':
        return { ok: true, op: cmd.op, sheet: 'Sheet1', sheets: ['Sheet1', 'Data'], rows: [['a', 'b'], ['1', '2']], truncated: false };
      case 'excelAddSheet':
        return { ok: true, op: cmd.op, sheet: (cmd.name as string | undefined) ?? 'Sheet2', sheets: ['Sheet1', (cmd.name as string | undefined) ?? 'Sheet2'] };
      case 'excelCreate':
        return { ok: true, op: cmd.op, name: 'Book1', sheets: ['Sheet1'] };
      case 'excelBatch': {
        const commands = (cmd.commands as Array<{ op: string }>) ?? [];
        return { ok: true, op: cmd.op, count: commands.length, results: commands.map((c) => ({ ok: true, op: c.op })) };
      }
      default: return { ok: true, op: cmd.op };
    }
  }),
  send: vi.fn(async (cmd: { op: string }) => { sent.push(cmd); return { ok: true, op: cmd.op }; }),
};

const hostMock = {
  getWordHost: vi.fn(() => fakeHost),
  refreshOwnedExcel: vi.fn(async () => undefined),
  runExclusive: vi.fn(<T>(fn: () => Promise<T>) => fn()),
  detectTools: vi.fn((): ToolAvailability => ({ powershell: true, word: true, wordVersion: '16.0', excel: true, excelVersion: '16.0', windows: true })),
};
vi.mock('../../electron/host/index.ts', () => hostMock);

let excel: typeof import('../../electron/adapters/excel.ts');
let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  sent.length = 0;
  excel = await import('../../electron/adapters/excel.ts');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-adapter-'));
});

const ops = () => sent.map((c) => c.op);

describe('descriptor / availability', () => {
  it('declares Excel as win32-only, reading xlsx and writing pdf/csv', () => {
    expect(excel.excelDescriptor.platforms).toEqual(['win32']);
    expect(excel.excelDescriptor.reads.some((e) => e.format === 'xlsx')).toBe(true);
    expect(excel.excelDescriptor.writes.some((e) => e.format === 'pdf')).toBe(true);
    expect(excel.excelDescriptor.writes.find((e) => e.format === 'csv')?.lossy).toBeTruthy();
  });

  it('available() reflects detectTools.excel', () => {
    expect(excel.available()).toEqual({ available: true, version: '16.0' });
    hostMock.detectTools.mockReturnValueOnce({ powershell: true, word: true, wordVersion: '16.0', excel: false, windows: true });
    expect(excel.available()).toMatchObject({ available: false });
  });
});

describe('exportSpreadsheet', () => {
  it('opens, records ownership, exports, and closes', async () => {
    const src = path.join(dir, 'a.xlsx'); fs.writeFileSync(src, 'x');
    const res = await excel.exportSpreadsheet(src, 'pdf', path.join(dir, 'a.pdf'));
    expect(res.outputPath).toBe(path.resolve(path.join(dir, 'a.pdf')));
    expect(ops()).toEqual(['excelOpen', 'excelExport', 'excelClose']);
    expect(sent.find((c) => c.op === 'excelExport')).toMatchObject({ format: 'pdf' });
    expect(hostMock.refreshOwnedExcel).toHaveBeenCalled();
  });

  it('rejects an output extension that does not match the target', async () => {
    const src = path.join(dir, 'a.xlsx'); fs.writeFileSync(src, 'x');
    await expect(excel.exportSpreadsheet(src, 'pdf', path.join(dir, 'a.csv'))).rejects.toThrow(/not allowed/);
    expect(fakeHost.sendOk).not.toHaveBeenCalled();
  });

  it('rejects a source that is not a spreadsheet', async () => {
    const src = path.join(dir, 'a.docx'); fs.writeFileSync(src, 'x');
    await expect(excel.exportSpreadsheet(src, 'pdf', path.join(dir, 'a.pdf'))).rejects.toThrow(/not allowed/);
  });
});

describe('readSheet', () => {
  it('opens, reads the used range, and always closes', async () => {
    const src = path.join(dir, 'a.xlsx'); fs.writeFileSync(src, 'x');
    const data = await excel.readSheet(src);
    expect(data).toMatchObject({ sheet: 'Sheet1', sheets: ['Sheet1', 'Data'], truncated: false });
    expect(data.rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(ops()).toEqual(['excelOpen', 'excelReadSheet', 'excelClose']);
  });

  it('passes an explicit sheet name through', async () => {
    const src = path.join(dir, 'a.xlsx'); fs.writeFileSync(src, 'x');
    await excel.readSheet(src, { sheet: 'Data' });
    expect(sent.find((c) => c.op === 'excelReadSheet')).toMatchObject({ sheet: 'Data' });
  });
});

describe('exclusivity', () => {
  it('every operation runs through runExclusive', async () => {
    const src = path.join(dir, 'a.xlsx'); fs.writeFileSync(src, 'x');
    await excel.readSheet(src);
    expect(hostMock.runExclusive).toHaveBeenCalled();
  });
});

describe('addSheet (M12 Phase D)', () => {
  it('opens, adds the sheet, re-saves, and closes', async () => {
    const src = path.join(dir, 'a.xlsx'); fs.writeFileSync(src, 'x');
    const r = await excel.addSheet(src, 'Data');
    expect(ops()).toEqual(['excelOpen', 'excelAddSheet', 'excelExport', 'excelClose']);
    expect(sent.find((c) => c.op === 'excelAddSheet')).toMatchObject({ name: 'Data' });
    expect(r).toMatchObject({ sheet: 'Data', sheets: ['Sheet1', 'Data'] });
  });
});

describe('buildWorkbook (M12 Phase D — one batched COM session)', () => {
  it('single sheet, xlsx: excelCreate -> excelBatch -> excelExport -> excelClose, no intermediate file', async () => {
    const out = path.join(dir, 'report.xlsx');
    const r = await excel.buildWorkbook(out, [{ name: 'زکوٰۃ', data: [['a', 1]] }]);
    expect(ops()).toEqual(['excelCreate', 'excelBatch', 'excelExport', 'excelClose']);
    expect(r.path).toBe(path.resolve(out));
    const batch = sent.find((c) => c.op === 'excelBatch') as unknown as { commands: Array<{ op: string; name?: string }> };
    expect(batch.commands[0]).toMatchObject({ op: 'excelRenameSheet', name: 'زکوٰۃ' });
    expect(batch.commands.some((c) => c.op === 'excelWriteRange')).toBe(true);
  });

  it('the FIRST sheet renames the default sheet; every other one is added — fixing the original per-sheet-name-must-already-exist bug', async () => {
    const out = path.join(dir, 'multi.xlsx');
    await excel.buildWorkbook(out, [
      { name: 'زکوٰۃ', data: [['a', 1]] },
      { name: 'خلاصہ', data: [['b', 2]] },
    ]);
    const batch = sent.find((c) => c.op === 'excelBatch') as unknown as { commands: Array<{ op: string; name?: string; sheet?: string }> };
    const kinds = batch.commands.map((c) => `${c.op}:${c.name ?? c.sheet ?? ''}`);
    expect(kinds).toEqual([
      'excelRenameSheet:زکوٰۃ',
      'excelWriteRange:زکوٰۃ',
      'excelAddSheet:خلاصہ',
      'excelWriteRange:خلاصہ',
    ]);
  });

  it('formulas (A1-notation cell) and format (incl. rtl/fontName) are forwarded per sheet, in order', async () => {
    const out = path.join(dir, 'f.xlsx');
    await excel.buildWorkbook(out, [{
      name: 'S1',
      data: [['a', 1]],
      formulas: [{ cell: 'C9', formula: '=SUM(B2:B8)' }],
      format: [{ range: 'A1:C1', bold: true, rtl: true, fontName: 'Jameel Noori Nastaleeq' }],
    }]);
    const batch = sent.find((c) => c.op === 'excelBatch') as unknown as { commands: Array<Record<string, unknown>> };
    expect(batch.commands.find((c) => c.op === 'excelSetFormula')).toMatchObject({ cell: 'C9', formula: '=SUM(B2:B8)' });
    expect(batch.commands.find((c) => c.op === 'excelFormat')).toMatchObject({
      range: 'A1:C1', bold: true, rtl: true, fontName: 'Jameel Noori Nastaleeq',
    });
  });

  it('format:"pdf" — builds at an intermediate .xlsx, exports twice, then deletes the intermediate (the original bug: the .xlsx-only path check ran against the FINAL .pdf path and threw before export)', async () => {
    const out = path.join(dir, 'report.pdf');
    const intermediate = path.join(dir, 'report.xlsx');
    fs.writeFileSync(intermediate, 'placeholder'); // stands in for what excelExport would have written
    const r = await excel.buildWorkbook(out, [{ name: 'S1', data: [['a', 1]] }], { format: 'pdf' });
    expect(r.path).toBe(path.resolve(out));
    const exports = sent.filter((c) => c.op === 'excelExport');
    expect(exports).toHaveLength(2);
    expect(exports[0]).toMatchObject({ format: 'xlsx', path: path.resolve(intermediate) });
    expect(exports[1]).toMatchObject({ format: 'pdf', path: path.resolve(out) });
    expect(fs.existsSync(intermediate)).toBe(false); // cleaned up — only the requested .pdf remains the deliverable
  });

  it('format inferred from the output extension when not given explicitly', async () => {
    const out = path.join(dir, 'x.csv');
    fs.writeFileSync(path.join(dir, 'x.xlsx'), 'placeholder');
    await excel.buildWorkbook(out, [{ name: 'S1' }]);
    const exports = sent.filter((c) => c.op === 'excelExport');
    expect(exports[exports.length - 1]).toMatchObject({ format: 'csv' });
  });

  it('rejects an empty sheet list without touching the host', async () => {
    await expect(excel.buildWorkbook(path.join(dir, 'x.xlsx'), [])).rejects.toThrow(/at least one sheet/);
    expect(fakeHost.sendOk).not.toHaveBeenCalled();
  });

  it('runs through runExclusive like every other op', async () => {
    await excel.buildWorkbook(path.join(dir, 'x.xlsx'), [{ name: 'S1' }]);
    expect(hostMock.runExclusive).toHaveBeenCalled();
  });
});
