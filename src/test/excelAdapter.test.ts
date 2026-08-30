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
  sendOk: vi.fn(async (cmd: { op: string }) => {
    sent.push(cmd);
    switch (cmd.op) {
      case 'excelOpen': return { ok: true, op: cmd.op, name: 'book.xlsx', sheets: ['Sheet1', 'Data'] };
      case 'excelReadSheet':
        return { ok: true, op: cmd.op, sheet: 'Sheet1', sheets: ['Sheet1', 'Data'], rows: [['a', 'b'], ['1', '2']], truncated: false };
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
