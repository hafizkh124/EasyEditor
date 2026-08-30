// @vitest-environment node
// electron/adapters/powerpoint.ts — the PowerPoint adapter (SPEC-M8 Layer 2 /
// P9). Layer 1 host mocked; pins the op sequences, path validation, and mutex.
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
      case 'pptOpen': return { ok: true, op: cmd.op, name: 'deck.pptx', slideCount: 3 };
      case 'pptReadOutline':
        return { ok: true, op: cmd.op, slideCount: 3, slides: [
          { index: 1, title: 'Intro', bullets: ['a', 'b'] },
          { index: 2, title: '', bullets: [] },
        ] };
      default: return { ok: true, op: cmd.op };
    }
  }),
  send: vi.fn(async (cmd: { op: string }) => { sent.push(cmd); return { ok: true, op: cmd.op }; }),
};

const hostMock = {
  getWordHost: vi.fn(() => fakeHost),
  refreshOwnedPowerpoint: vi.fn(async () => undefined),
  runExclusive: vi.fn(<T>(fn: () => Promise<T>) => fn()),
  detectTools: vi.fn((): ToolAvailability => ({ powershell: true, word: true, wordVersion: '16.0', powerpoint: true, powerpointVersion: '16.0', windows: true })),
};
vi.mock('../../electron/host/index.ts', () => hostMock);

let ppt: typeof import('../../electron/adapters/powerpoint.ts');
let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  sent.length = 0;
  ppt = await import('../../electron/adapters/powerpoint.ts');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-adapter-'));
});

const ops = () => sent.map((c) => c.op);

describe('descriptor / availability', () => {
  it('declares PowerPoint as win32-only, reading pptx and writing pdf', () => {
    expect(ppt.powerpointDescriptor.platforms).toEqual(['win32']);
    expect(ppt.powerpointDescriptor.reads.some((e) => e.format === 'pptx')).toBe(true);
    expect(ppt.powerpointDescriptor.writes.find((e) => e.format === 'pdf')?.lossy).toBeTruthy();
  });

  it('available() reflects detectTools.powerpoint', () => {
    expect(ppt.available()).toEqual({ available: true, version: '16.0' });
    hostMock.detectTools.mockReturnValueOnce({ powershell: true, word: true, wordVersion: '16.0', powerpoint: false, windows: true });
    expect(ppt.available()).toMatchObject({ available: false });
  });
});

describe('exportPresentation', () => {
  it('opens, records ownership, exports, and closes', async () => {
    const src = path.join(dir, 'a.pptx'); fs.writeFileSync(src, 'x');
    await ppt.exportPresentation(src, 'pdf', path.join(dir, 'a.pdf'));
    expect(ops()).toEqual(['pptOpen', 'pptExport', 'pptClose']);
    expect(sent.find((c) => c.op === 'pptExport')).toMatchObject({ format: 'pdf' });
    expect(hostMock.refreshOwnedPowerpoint).toHaveBeenCalled();
  });

  it('rejects a mismatched output extension', async () => {
    const src = path.join(dir, 'a.pptx'); fs.writeFileSync(src, 'x');
    await expect(ppt.exportPresentation(src, 'pdf', path.join(dir, 'a.pptx'))).rejects.toThrow(/not allowed/);
  });
});

describe('readOutline', () => {
  it('opens, reads the outline, and always closes', async () => {
    const src = path.join(dir, 'a.pptx'); fs.writeFileSync(src, 'x');
    const deck = await ppt.readOutline(src);
    expect(deck.slideCount).toBe(3);
    expect(deck.slides[0]).toEqual({ index: 1, title: 'Intro', bullets: ['a', 'b'] });
    expect(ops()).toEqual(['pptOpen', 'pptReadOutline', 'pptClose']);
  });
});

describe('exclusivity', () => {
  it('every operation runs through runExclusive', async () => {
    const src = path.join(dir, 'a.pptx'); fs.writeFileSync(src, 'x');
    await ppt.readOutline(src);
    expect(hostMock.runExclusive).toHaveBeenCalled();
  });
});
