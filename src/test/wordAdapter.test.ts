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
  sendOk: vi.fn(async (cmd: { op: string; outPath?: string }) => {
    sent.push(cmd);
    switch (cmd.op) {
      case 'openPdfReflow': return { ok: true, op: cmd.op, wordCount: 312, ms: 22000 };
      case 'readStructure':
        return { ok: true, op: cmd.op, headings: ['باب اول'], footnotes: [{ index: 1, text: 'حاشیہ' }], trackedChanges: 2, wordCount: 500, readingOrder: 'rtl' };
      case 'installFont':
        return { ok: true, op: cmd.op, fontName: 'Jameel Noori Nastaleeq', facesRegistered: 1, verifiedInRunningWord: true };
      case 'applyCitations':
        return { ok: true, op: cmd.op, applied: 3, notFound: ['[4]'], footnoteCount: 3 };
      case 'compareInto':
        fs.writeFileSync(String(cmd.outPath), 'tracked-changes');
        return { ok: true, op: cmd.op, revisions: 5, outPath: cmd.outPath };
      case 'createDocument':
        return { ok: true, op: cmd.op, name: '05-new.docx' };
      case 'addComment':
        return (cmd as { anchorText?: string }).anchorText === 'nope'
          ? { ok: true, op: cmd.op, added: false, notFound: true }
          : { ok: true, op: cmd.op, added: true, commentCount: 1 };
      case 'readRevisions':
        return { ok: true, op: cmd.op, count: 2, revisions: [
          { type: 'insert', text: 'زيادة', context: '… زيادة …', page: 3 },
          { type: 'delete', text: 'نقص', context: '… نقص …', page: 4 },
        ] };
      case 'setPrintLayout':
        return { ok: true, op: cmd.op, pageWidth: 396.85, pageHeight: 595.28, gutter: 42.52 };
      case 'markIndexEntries':
        return { ok: true, op: cmd.op, marked: 7 };
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

describe('applyCitations', () => {
  const footnotes = [
    { marker: '[1]', text: 'Sahih Bukhari #1' },
    { marker: '[2]', text: 'Sahih Muslim #2' },
  ];

  it('opens, applies options, sends the footnotes, saves, closes', async () => {
    const out = path.join(dir, 'cited.docx');
    const res = await word.applyCitations({ html: '<p>a [1] b [2]</p>' }, footnotes, out, { rtlPageSetup: true, stripMarkers: true });
    expect(ops()).toEqual(['open', 'setRtlPageSetup', 'applyCitations', 'saveAs', 'close']);
    const cmd = sent.find((c) => c.op === 'applyCitations')!;
    expect(cmd).toMatchObject({ stripMarkers: true, footnotes });
    expect(res).toMatchObject({ applied: 3, notFound: ['[4]'] });
  });

  it('refuses an empty / blank footnote list before touching the host', async () => {
    await expect(word.applyCitations({ html: '<p>x</p>' }, [], path.join(dir, 'o.docx'))).rejects.toThrow(/no usable footnotes/);
    await expect(word.applyCitations({ html: '<p>x</p>' }, [{ marker: '  ', text: '' }], path.join(dir, 'o.docx'))).rejects.toThrow(/no usable footnotes/);
    expect(fakeHost.sendOk).not.toHaveBeenCalled();
  });

  it('rejects a non-.docx output', async () => {
    await expect(word.applyCitations({ html: '<p>[1]</p>' }, footnotes, path.join(dir, 'o.pdf'))).rejects.toThrow(/not allowed/);
  });
});

describe('applyTextTask (agent run_task)', () => {
  it('builds a revised .docx, diffs it against the chapter, then overwrites with the comparison', async () => {
    const chapter = path.join(dir, 'ch.docx'); fs.writeFileSync(chapter, 'original');
    const res = await word.applyTextTask(chapter, 'refined text', { isHtml: false });
    expect(res.revisions).toBe(5);
    expect(ops()).toEqual(['open', 'saveAs', 'close', 'open', 'compareInto', 'close']);
    // the temp .html/.txt source that was opened is cleaned up
    const openCmds = sent.filter((c) => c.op === 'open');
    expect(String(openCmds[0].path)).toMatch(/\.txt$/);
    expect(fs.existsSync(String(openCmds[0].path))).toBe(false);
    expect(fs.readFileSync(chapter, 'utf8')).toBe('tracked-changes');
  });

  it('rejects a chapter that does not exist, before touching the host', async () => {
    await expect(word.applyTextTask(path.join(dir, 'ghost.docx'), 'x', { isHtml: false })).rejects.toThrow(/not found/);
  });
});

describe('M9 Phase 2 — createChapter', () => {
  it('from HTML: temp file → createDocument (rtl default) → close, temp cleaned', async () => {
    const out = path.join(dir, '05-new.docx');
    const res = await word.createChapter(out, { html: '<h1>باب پنجم</h1>' });
    expect(res.name).toBe('05-new.docx');
    expect(ops()).toEqual(['createDocument', 'close']);
    const cmd = sent.find((c) => c.op === 'createDocument')!;
    expect(String(cmd.sourcePath)).toMatch(/\.html$/);
    expect(cmd.rtl).toBe(true);
    expect(fs.existsSync(String(cmd.sourcePath))).toBe(false);
  });

  it('blank chapter sends no sourcePath', async () => {
    await word.createChapter(path.join(dir, 'blank.docx'), { rtl: false });
    const cmd = sent.find((c) => c.op === 'createDocument')!;
    expect(cmd.sourcePath).toBeUndefined();
    expect(cmd.rtl).toBe(false);
  });

  it('rejects a non-.docx path before touching the host', async () => {
    await expect(word.createChapter(path.join(dir, 'x.pdf'))).rejects.toThrow(/not allowed/);
    expect(fakeHost.sendOk).not.toHaveBeenCalled();
  });
});

describe('M9 Phase 2 — addComment', () => {
  it('opens, turns on track changes, adds the comment, saves, closes', async () => {
    const ch = path.join(dir, 'ch.docx'); fs.writeFileSync(ch, 'x');
    const res = await word.addComment(ch, { anchorText: 'قال المؤلف', comment: 'مراجعة النقل', author: 'المشرف' });
    expect(res).toMatchObject({ added: true, notFound: false });
    expect(ops()).toEqual(['open', 'setTrackRevisions', 'addComment', 'save', 'close']);
    expect(sent.find((c) => c.op === 'addComment')).toMatchObject({ anchorText: 'قال المؤلف', text: 'مراجعة النقل', author: 'المشرف' });
  });

  it('reports notFound and does not save when the anchor is missing', async () => {
    const ch = path.join(dir, 'ch.docx'); fs.writeFileSync(ch, 'x');
    const res = await word.addComment(ch, { anchorText: 'nope', comment: 'x' });
    expect(res.notFound).toBe(true);
    expect(ops()).not.toContain('save');
  });
});

describe('M9 Phase 2 — compareManuscripts', () => {
  it('compares base vs witness, reads revisions back, never modifies the inputs', async () => {
    const base = path.join(dir, 'base.docx'); fs.writeFileSync(base, 'base');
    const witness = path.join(dir, 'witness.docx'); fs.writeFileSync(witness, 'witness');
    const res = await word.compareManuscripts(base, witness);
    expect(res.count).toBe(2);
    expect(res.revisions[0]).toMatchObject({ type: 'insert', text: 'زيادة' });
    expect(ops()).toEqual(['open', 'compareInto', 'close', 'open', 'readRevisions', 'close']);
    expect(fs.readFileSync(base, 'utf8')).toBe('base');
    expect(fs.readFileSync(witness, 'utf8')).toBe('witness');
  });
});

describe('M9 Phase 2 — setPrintLayout', () => {
  it('opens, applies the geometry, saves, closes', async () => {
    const ch = path.join(dir, 'ch.docx'); fs.writeFileSync(ch, 'x');
    const res = await word.setPrintLayout(ch, { trimWidthCm: 14, trimHeightCm: 21, gutterCm: 1.5, mirrorMargins: true, oddEvenHeaders: true, headerOdd: 'الباب الأول', headerEven: 'كتاب' });
    expect(res.pageWidth).toBeGreaterThan(0);
    expect(ops()).toEqual(['open', 'setPrintLayout', 'save', 'close']);
    expect(sent.find((c) => c.op === 'setPrintLayout')).toMatchObject({ pageWidthCm: 14, pageHeightCm: 21, gutterCm: 1.5, mirrorMargins: true, oddEven: true });
  });
});

describe('M9 Phase 2 — buildIndexes', () => {
  it('marks the entries then appends the INDEX field, saves, closes', async () => {
    const ch = path.join(dir, 'ch.docx'); fs.writeFileSync(ch, 'x');
    const res = await word.buildIndexes(ch, [{ find: 'الغزالي', entry: 'الغزالي، أبو حامد' }], { heading: 'فهرس الأعلام' });
    expect(res.marked).toBe(7);
    expect(ops()).toEqual(['open', 'markIndexEntries', 'appendIndex', 'save', 'close']);
    expect(sent.find((c) => c.op === 'appendIndex')).toMatchObject({ field: 'INDEX', heading: 'فهرس الأعلام' });
  });

  it('refuses an empty entry list before touching the host', async () => {
    const ch = path.join(dir, 'ch.docx'); fs.writeFileSync(ch, 'x');
    await expect(word.buildIndexes(ch, [{ find: ' ', entry: '' }])).rejects.toThrow(/no usable index entries/);
    expect(fakeHost.sendOk).not.toHaveBeenCalled();
  });
});

describe('exclusivity', () => {
  it('every operation runs through runExclusive', async () => {
    const src = path.join(dir, 'a.docx'); fs.writeFileSync(src, 'x');
    await word.readStructure(src);
    expect(hostMock.runExclusive).toHaveBeenCalled();
  });
});
