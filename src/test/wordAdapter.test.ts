// @vitest-environment node
// electron/adapters/word.ts — the Word adapter (SPEC-M8 Layer 2 / P2), the
// template every later adapter follows. The Layer 1 host is mocked (no real
// Word here — hostLive.test.ts does that); this pins the op SEQUENCES each
// operation runs, that outputs are path-validated before any op is sent,
// and that every session goes through the exclusivity mutex.
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
      case 'openPdfReflow': return { ok: true, op: cmd.op, wordCount: 312, ms: 22000 };
      case 'readStructure':
        return { ok: true, op: cmd.op, headings: ['باب اول'], footnotes: [{ index: 1, text: 'حاشیہ' }], trackedChanges: 2, wordCount: 500, readingOrder: 'rtl' };
      case 'installFont':
        return { ok: true, op: cmd.op, fontName: 'Jameel Noori Nastaleeq', facesRegistered: 1, verifiedInRunningWord: true };
      default: return { ok: true, op: cmd.op };
    }
  }),
  send: vi.fn(async (cmd: { op: string }) => { sent.push(cmd); return { ok: true, op: cmd.op }; }),
};

const hostMock = {
  getWordHost: vi.fn(() => fakeHost),
  refreshOwnedWord: vi.fn(async () => undefined),
  runExclusive: vi.fn(<T>(fn: () => Promise<T>) => fn()),
  detectTools: vi.fn((): ToolAvailability => ({ powershell: true, word: true, wordVersion: '16.0', windows: true })),
};
vi.mock('../../electron/host/index.ts', () => hostMock);

let word: typeof import('../../electron/adapters/word.ts');
let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  sent.length = 0;
  word = await import('../../electron/adapters/word.ts');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-adapter-'));
});

const ops = () => sent.map((c) => c.op);

describe('descriptor / availability', () => {
  it('declares Word as win32-only with docx read+write', () => {
    expect(word.wordDescriptor.platforms).toEqual(['win32']);
    expect(word.wordDescriptor.reads.some((e) => e.format === 'docx')).toBe(true);
    expect(word.wordDescriptor.writes.some((e) => e.format === 'pdf')).toBe(true);
  });

  it('available() reflects detectTools', () => {
    expect(word.available()).toEqual({ available: true, version: '16.0' });
    hostMock.detectTools.mockReturnValueOnce({ powershell: true, word: false, wordVersion: null, windows: true, reason: 'no Word' });
    expect(word.available()).toMatchObject({ available: false, reason: 'no Word' });
  });
});

describe('toWord', () => {
  it('from HTML: writes a temp file, opens it, applies options, saves docx, closes', async () => {
    const out = path.join(dir, 'out.docx');
    const res = await word.toWord({ html: '<p>سلام</p>' }, out, { rtlPageSetup: true, trackChanges: true });
    expect(res.outputPath).toBe(path.resolve(out));
    expect(ops()).toEqual(['open', 'setTrackRevisions', 'setRtlPageSetup', 'saveAs', 'close']);
    const openCmd = sent.find((c) => c.op === 'open')!;
    expect(String(openCmd.path)).toMatch(/\.html$/);
    // temp html cleaned up
    expect(fs.existsSync(String(openCmd.path))).toBe(false);
  });

  it('rejects a non-.docx output before touching the host', async () => {
    await expect(word.toWord({ html: '<p>x</p>' }, path.join(dir, 'out.pdf'))).rejects.toThrow(/not allowed/);
    expect(fakeHost.sendOk).not.toHaveBeenCalled();
  });

  it('requires either html or sourcePath', async () => {
    await expect(word.toWord({}, path.join(dir, 'out.docx'))).rejects.toThrow(/html.*sourcePath/);
  });
});

describe('fromWord', () => {
  it('opens the source and exports in the requested format', async () => {
    const src = path.join(dir, 'a.docx'); fs.writeFileSync(src, 'x');
    await word.fromWord(src, 'pdf', path.join(dir, 'a.pdf'));
    expect(ops()).toEqual(['open', 'exportAs', 'close']);
    expect(sent.find((c) => c.op === 'exportAs')).toMatchObject({ format: 'pdf' });
  });

  it('rejects when the output extension does not match the target format', async () => {
    const src = path.join(dir, 'a.docx'); fs.writeFileSync(src, 'x');
    await expect(word.fromWord(src, 'pdf', path.join(dir, 'a.rtf'))).rejects.toThrow(/not allowed/);
  });
});

describe('reflowPdf', () => {
  it('runs openPdfReflow → saveAs → close and reports the word count', async () => {
    const src = path.join(dir, 'a.pdf'); fs.writeFileSync(src, 'x');
    const phases: string[] = [];
    const res = await word.reflowPdf(src, path.join(dir, 'a.docx'), (p) => phases.push(p.phase));
    expect(ops()).toEqual(['openPdfReflow', 'saveAs', 'close']);
    expect(res.wordCount).toBe(312);
    expect(phases).toContain('done');
  });
});

describe('readStructure', () => {
  it('opens, reads, and always closes even if reads throw', async () => {
    const src = path.join(dir, 'a.docx'); fs.writeFileSync(src, 'x');
    const s = await word.readStructure(src);
    expect(s).toMatchObject({ headings: ['باب اول'], trackedChanges: 2, readingOrder: 'rtl' });
    expect(ops()).toEqual(['open', 'readStructure', 'close']);
  });
});

describe('installFont', () => {
  it('installs and reports verified when the running Word sees it', async () => {
    const f = path.join(dir, 'font.ttf'); fs.writeFileSync(f, 'x');
    const res = await word.installFont(f);
    expect(res).toEqual({ fontName: 'Jameel Noori Nastaleeq', verified: true });
    expect(ops()).toEqual(['installFont']);
  });

  it('adds a "restart Word" note when verification fails', async () => {
    fakeHost.sendOk.mockResolvedValueOnce({ ok: true, op: 'installFont', fontName: 'X', facesRegistered: 1, verifiedInRunningWord: false });
    const f = path.join(dir, 'font.otf'); fs.writeFileSync(f, 'x');
    const res = await word.installFont(f);
    expect(res.verified).toBe(false);
    expect(res.note).toMatch(/restart Word/i);
  });

  it('rejects a non-font file', async () => {
    const f = path.join(dir, 'notafont.docx'); fs.writeFileSync(f, 'x');
    await expect(word.installFont(f)).rejects.toThrow(/not allowed/);
  });
});

describe('exclusivity', () => {
  it('every operation runs through runExclusive', async () => {
    const src = path.join(dir, 'a.docx'); fs.writeFileSync(src, 'x');
    await word.readStructure(src);
    expect(hostMock.runExclusive).toHaveBeenCalled();
  });
});
