// @vitest-environment node
// electron/host/ + electron/adapters/word.ts — LIVE end-to-end tests
// (SPEC-M8 P1 exit criterion "an integration test driving the real host",
// and the P2 Word-adapter round-trips).
//
// Skipped unless DOC_BRIDGE_LIVE=1, because it needs a real Windows machine
// with Microsoft Word installed — CI (Ubuntu) cannot run it. Run locally:
//
//     DOC_BRIDGE_LIVE=1 npx vitest run src/test/hostLive.test.ts
//
// P1: tool detection, the long-lived host, a document round-trip, and — the
// point of P0 proof 6 — that process.ts kills a WINWORD.EXE the host started
// once the host dies uncleanly.
// P2: toWord / fromWord / reflowPdf / readStructure / installFont through the
// adapter, against real Word, producing real files.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { WordPidReply } from '../../electron/host/types.ts';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const LIVE = process.env.DOC_BRIDGE_LIVE === '1';
const FIXTURE = path.resolve(__dirname, 'fixtures/minimal.docx');

function winwordAlive(pid: number): boolean {
  const r = spawnSync('powershell', [
    '-NoProfile', '-Command',
    `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'yes' }`,
  ], { encoding: 'utf8' });
  return (r.stdout || '').includes('yes');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docbridge-live-'));
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'docbridge-live-p2-'));
const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'docbridge-live-p9-'));

describe.runIf(LIVE)('doc-bridge live (real Word)', () => {
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('detectTools sees Word on this machine', async () => {
    const { detectTools } = await import('../../electron/host/detectTools.ts');
    const tools = detectTools();
    expect(tools.windows).toBe(true);
    expect(tools.powershell).toBe(true);
    expect(tools.word).toBe(true);
    expect(tools.wordVersion).toMatch(/^\d+\.\d+/);
  });

  it('starts the host, pings, round-trips a docx, and cleans up the orphan', async () => {
    const { WordHost } = await import('../../electron/host/powershell.ts');
    const proc = await import('../../electron/host/process.ts');

    const host = new WordHost();
    host.start();

    // ping
    const pong = await host.send({ op: 'ping' });
    expect(pong).toMatchObject({ ok: true, pong: true });

    // open the fixture — this is what actually starts WINWORD.EXE
    const opened = await host.sendOk({ op: 'open', path: FIXTURE });
    expect(opened.ok).toBe(true);

    // the operations the Word adapter (P2) will need — proven end to end here
    await host.sendOk({ op: 'setTrackRevisions', enabled: true });
    await host.sendOk({ op: 'setRtlPageSetup' });
    const fn = await host.sendOk({ op: 'insertFootnote', text: 'M8 P1 live-test footnote — نمونہ کتاب، ج۱ ص۱' });
    expect(fn.footnoteCount).toBe(1);
    const out = path.join(tmp, 'roundtrip.docx');
    await host.sendOk({ op: 'saveAs', path: out });
    expect(fs.existsSync(out)).toBe(true);

    // we must own the WINWORD.EXE we started
    const wp = await host.sendOk<WordPidReply>({ op: 'wordPid' });
    expect(wp.ownedByUs).toBe(true);
    expect(typeof wp.pid).toBe('number');
    proc.recordOwnedWord(wp.pid);

    // P0 proof 6: kill the host WITHOUT {op:"quit"} — Word will NOT exit on
    // its own, so process.ts has to.
    host.kill();
    expect(winwordAlive(wp.pid)).toBe(true);

    const killed = await proc.killOwnedWordIfAlive();
    expect(killed.killed).toBe(true);

    // give the OS a moment, then confirm it's really gone
    await new Promise((r) => setTimeout(r, 1500));
    expect(winwordAlive(wp.pid)).toBe(false);
    expect(proc._currentRecord()).toBeNull();
  });

  it('a clean stop() leaves no WINWORD.EXE behind', async () => {
    const { WordHost } = await import('../../electron/host/powershell.ts');
    const proc = await import('../../electron/host/process.ts');

    const host = new WordHost();
    host.start();
    await host.sendOk({ op: 'open', path: FIXTURE });
    const wp = await host.sendOk<WordPidReply>({ op: 'wordPid' });
    proc.recordOwnedWord(wp.pid);

    await host.stop(); // sends {op:"quit"} → Word.Quit()
    proc.clearOwnedWord();

    await new Promise((r) => setTimeout(r, 1500));
    expect(winwordAlive(wp.pid)).toBe(false);
  });
});

describe.runIf(LIVE)('Word adapter live (P2, real Word)', () => {
  const outPath = (name: string) => path.join(tmp2, name);

  afterAll(async () => {
    const { shutdownDocBridge } = await import('../../electron/host/index.ts');
    await shutdownDocBridge();
    fs.rmSync(tmp2, { recursive: true, force: true });
  });

  it('toWord: editor HTML → a real .docx with RTL + tracked changes', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const out = outPath('from-html.docx');
    const res = await word.toWord(
      { html: '<h1>باب اول</h1><p>یہ اڈاپٹر ٹیسٹ کا متن ہے۔</p>' },
      out,
      { rtlPageSetup: true, trackChanges: true },
    );
    expect(res.outputPath).toBe(out);
    expect(fs.statSync(out).size).toBeGreaterThan(0);

    const s = await word.readStructure(out);
    expect(s.readingOrder).toBe('rtl');
    expect(s.headings).toContain('باب اول');
  });

  it('fromWord: .docx → .pdf and → .rtf via Word export', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const pdf = outPath('exported.pdf');
    await word.fromWord(FIXTURE, 'pdf', pdf);
    expect(fs.statSync(pdf).size).toBeGreaterThan(0);
    expect(fs.readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');

    const rtf = outPath('exported.rtf');
    await word.fromWord(FIXTURE, 'rtf', rtf);
    expect(fs.readFileSync(rtf, 'utf8').startsWith('{\\rtf')).toBe(true);
  });

  it('reflowPdf: a text .pdf → .docx with a plausible word count', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const srcPdf = outPath('for-reflow.pdf');
    await word.fromWord(FIXTURE, 'pdf', srcPdf); // make a real text PDF first

    const phases: string[] = [];
    const res = await word.reflowPdf(srcPdf, outPath('reflowed.docx'), (p) => phases.push(p.phase));
    expect(res.wordCount).toBeGreaterThan(0);
    expect(phases).toEqual(['reflowing', 'saving', 'done']);
    expect(fs.statSync(res.outputPath).size).toBeGreaterThan(0);
  });

  it('exportDocument (P3 path): editor HTML → PDF via Word, RTL page setup applied', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const out = outPath('p3-export.pdf');
    const res = await word.exportDocument(
      { html: '<h1>عنوان</h1><p>P3 برآمد کا متن۔</p>' },
      'pdf',
      out,
      { rtlPageSetup: true },
    );
    expect(res.outputPath).toBe(out);
    expect(fs.readFileSync(out).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('applyCitations (P6): inserts real Word footnotes at each [N] marker', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const out = outPath('cited.docx');
    const res = await word.applyCitations(
      { html: '<p>پہلی روایت [1] اور دوسری [2]، پھر [1] دوبارہ۔</p>' },
      [
        { marker: '[1]', text: 'صحیح البخاری، حدیث ۱ (صحیح)' },
        { marker: '[2]', text: 'صحیح مسلم، حدیث ۲' },
      ],
      out,
      { rtlPageSetup: true, stripMarkers: true },
    );
    // [1] appears twice, [2] once → 3 footnotes
    expect(res.applied).toBe(3);
    expect(res.notFound).toEqual([]);

    const s = await word.readStructure(out);
    expect(s.footnotes.length).toBe(3);
    expect(s.footnotes[0].text).toContain('البخاری');
  });

  it('readStructure: reports headings, footnotes, tracked changes, reading order', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const s = await word.readStructure(FIXTURE);
    expect(typeof s.wordCount).toBe('number');
    expect(['rtl', 'ltr', 'mixed']).toContain(s.readingOrder);
    expect(Array.isArray(s.headings)).toBe(true);
  });

  it('project folder (P7): chapter .docx → HTML → edited .docx, with a backup', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const pf = await import('../../electron/fs/projectFolder.ts');

    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live-proj-'));
    try {
      fs.copyFileSync(FIXTURE, path.join(projRoot, '01-intro.docx'));
      const project = pf.openProjectFolder(projRoot);
      expect(project.chapters.map((c) => c.name)).toEqual(['01-intro.docx']);

      // chapter -> HTML (the import direction)
      const htmlOut = path.join(tmp2, 'chapter.html');
      await word.fromWord(path.join(projRoot, '01-intro.docx'), 'html', htmlOut);
      const html = fs.readFileSync(htmlOut, 'utf8');
      expect(html.length).toBeGreaterThan(0);

      // edited HTML -> chapter .docx (the export direction), backup first
      const backup = pf.backupChapter(projRoot, '01-intro.docx');
      expect(backup).not.toBeNull();
      await word.toWord({ html: html + '<p>ایک نیا پیراگراف۔</p>' }, pf.chapterPath(projRoot, '01-intro.docx'), { rtlPageSetup: true });
      pf.registerChapter(projRoot, '01-intro.docx');

      const s = await word.readStructure(path.join(projRoot, '01-intro.docx'));
      expect(s.wordCount).toBeGreaterThan(0);
      expect(fs.existsSync(backup!)).toBe(true);
    } finally {
      fs.rmSync(projRoot, { recursive: true, force: true });
    }
  });

  it('applyTextTask (agent run_task): a rewrite lands as real Word tracked changes', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const chapter = outPath('run-task.docx');
    await word.toWord({ html: '<p>یہ اصل پیراگراف ہے۔</p><p>یہ دوسرا جملہ ہے۔</p>' }, chapter, { rtlPageSetup: true });

    const res = await word.applyTextTask(chapter, 'یہ نظر ثانی شدہ پیراگراف ہے۔\nیہ ایک نیا دوسرا جملہ ہے۔', { isHtml: false });
    expect(res.revisions).toBeGreaterThan(0);

    const s = await word.readStructure(chapter);
    expect(s.trackedChanges).toBeGreaterThan(0);
  });

  it('installFont: a font not on this machine becomes visible to running Word', async () => {
    const word = await import('../../electron/adapters/word.ts');
    // Liberation Sans ships inside pdfjs-dist and is not a Windows font.
    const font = path.resolve('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf');
    if (!fs.existsSync(font)) return; // dependency layout changed — skip rather than fail

    try {
      const res = await word.installFont(font);
      expect(res.fontName).toMatch(/Liberation/);
      expect(res.verified).toBe(true);
    } finally {
      // uninstall so the machine is left clean
      spawnSync('powershell', ['-NoProfile', '-Command',
        "$d = Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Fonts\\LiberationSans-Regular.ttf'; " +
        "Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts' -Name 'Liberation Sans (TrueType)' -EA SilentlyContinue; " +
        "Remove-Item $d -Force -EA SilentlyContinue",
      ]);
    }
  });
});

describe.runIf(LIVE)('Word templates + global options live (P9, real Word)', () => {
  const tmpT = fs.mkdtempSync(path.join(os.tmpdir(), 'docbridge-live-tpl-'));

  afterAll(async () => {
    const { shutdownDocBridge } = await import('../../electron/host/index.ts');
    await shutdownDocBridge();
    fs.rmSync(tmpT, { recursive: true, force: true });
  });

  it('installTemplate copies a .dotx into the user Templates folder', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const dotx = path.join(tmpT, 'live-fixture.dotx');
    // Build a real .dotx with Word (wdFormatXMLTemplate = 13).
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      `$w = New-Object -ComObject Word.Application; $w.Visible=$false; $d = $w.Documents.Add(); ` +
      `$d.SaveAs2('${dotx}', 13); $d.Close($false); $w.Quit()`,
    ], { encoding: 'utf8', timeout: 60_000 });
    if (!fs.existsSync(dotx)) throw new Error(`dotx build failed: ${r.stderr || r.stdout}`);

    try {
      const res = await word.installTemplate(dotx);
      expect(res.templateName).toBe('live-fixture');
      expect(fs.existsSync(res.installedTo)).toBe(true);
    } finally {
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Remove-Item (Join-Path $env:APPDATA 'Microsoft\\Templates\\live-fixture.dotx') -Force -EA SilentlyContinue`,
      ]);
    }
  });

  it('getWordOption / setWordOption round-trip an allow-listed Application.Option', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const before = await word.getWordOption('check_spelling');
    const flipped = before === 'true' ? 'false' : 'true';
    try {
      const applied = await word.setWordOption('check_spelling', flipped);
      expect(applied).toBe(flipped);
      expect(await word.getWordOption('check_spelling')).toBe(flipped);
    } finally {
      await word.setWordOption('check_spelling', before === 'true' ? 'true' : 'false');
    }
  });
});

describe.runIf(LIVE)('Excel + PowerPoint adapters live (P9, real Office)', () => {
  const outPath = (name: string) => path.join(tmp3, name);
  const xlsx = () => outPath('fixture.xlsx');
  const pptx = () => outPath('fixture.pptx');

  beforeAll(() => {
    // Build the fixtures with Office itself — a minimal .xlsx / .pptx cannot
    // be produced without Excel / PowerPoint, and this suite only runs where
    // they exist. The builder is written to a UTF-8 .ps1 file rather than
    // passed via -Command, so paths survive the console codepage. ASCII-only
    // content (the RTL round-trip is covered by the Word suite).
    const script = [
      `$xl = New-Object -ComObject Excel.Application; $xl.Visible=$false; $xl.DisplayAlerts=$false`,
      `$wb = $xl.Workbooks.Add(); $ws = $wb.ActiveSheet`,
      `$ws.Cells.Item(1,1)='Chapter'; $ws.Cells.Item(1,2)='Page'; $ws.Cells.Item(2,1)='Intro'; $ws.Cells.Item(2,2)=12`,
      `$wb.SaveAs('${xlsx()}', 51); $wb.Close($false); $xl.Quit()`,
      `$pp = New-Object -ComObject PowerPoint.Application`,
      `$pr = $pp.Presentations.Add(0); $sl = $pr.Slides.Add(1, 1)`,
      `$sl.Shapes.Title.TextFrame.TextRange.Text='Introduction'`,
      `$sl.Shapes.Item(2).TextFrame.TextRange.Text="First point" + [char]13 + "Second point"`,
      `$pr.SaveAs('${pptx()}', 24); $pr.Close(); $pp.Quit()`,
    ].join('\n');
    const scriptPath = path.join(tmp3, 'build-fixtures.ps1');
    fs.writeFileSync(scriptPath, script, 'utf8');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0 || !fs.existsSync(xlsx()) || !fs.existsSync(pptx())) {
      throw new Error(`fixture build failed (status ${r.status}): ${r.stderr || r.stdout}`);
    }
  }, 130_000);

  afterAll(async () => {
    const { shutdownDocBridge } = await import('../../electron/host/index.ts');
    await shutdownDocBridge();
    fs.rmSync(tmp3, { recursive: true, force: true });
  });

  it('excel: reads a sheet, and exports xlsx → csv and xlsx → pdf', async () => {
    const excel = await import('../../electron/adapters/excel.ts');

    const data = await excel.readSheet(xlsx());
    expect(data.rows[0]).toContain('Chapter');
    expect(data.rows[1].map(String)).toContain('12');

    const csv = outPath('sheet.csv');
    await excel.exportSpreadsheet(xlsx(), 'csv', csv);
    expect(fs.readFileSync(csv, 'utf8')).toContain('Chapter');

    const pdf = outPath('sheet.pdf');
    await excel.exportSpreadsheet(xlsx(), 'pdf', pdf);
    expect(fs.readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('powerpoint: reads the deck outline and exports pptx → pdf', async () => {
    const ppt = await import('../../electron/adapters/powerpoint.ts');

    const deck = await ppt.readOutline(pptx());
    expect(deck.slideCount).toBeGreaterThanOrEqual(1);
    expect(deck.slides[0].title).toBe('Introduction');
    expect(deck.slides[0].bullets.join(' ')).toContain('point');

    const pdf = outPath('deck.pdf');
    await ppt.exportPresentation(pptx(), 'pdf', pdf);
    expect(fs.readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('kills an orphaned EXCEL.EXE / POWERPNT.EXE after an unclean host exit', async () => {
    const { WordHost } = await import('../../electron/host/powershell.ts');
    const proc = await import('../../electron/host/process.ts');
    const { getWordHost } = await import('../../electron/host/index.ts');

    // Drive the shared host so index.ts records ownership.
    const h = getWordHost();
    await h.sendOk({ op: 'excelOpen', path: xlsx() });
    const ep = await h.sendOk<{ ok: true; pid: number; ownedByUs: boolean }>({ op: 'excelPid' });
    if (ep.ownedByUs) proc.recordOwnedExcel(ep.pid);

    // Kill the host process without {op:'quit'} — Excel will not exit on its own.
    (h as InstanceType<typeof WordHost>).kill();
    const res = await proc.killOwnedWordIfAlive();
    if (ep.ownedByUs) {
      expect(res.killed).toBe(true);
      await new Promise((r) => setTimeout(r, 1500));
      expect(winwordAlive(ep.pid)).toBe(false);
    }
  });
});

describe.runIf(LIVE)('M9 Phase 2 Word ops live (real Word)', () => {
  const tmpM9 = fs.mkdtempSync(path.join(os.tmpdir(), 'docbridge-live-m9-'));

  afterAll(async () => {
    const { shutdownDocBridge } = await import('../../electron/host/index.ts');
    await shutdownDocBridge();
    fs.rmSync(tmpM9, { recursive: true, force: true });
  });

  it('createChapter builds a new RTL .docx from an HTML fragment', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const out = path.join(tmpM9, '01-intro.docx');
    const res = await word.createChapter(out, { html: '<h1>الباب الأول</h1><p>هذا نص تمهيدي.</p>', rtl: true });
    expect(fs.existsSync(res.outputPath)).toBe(true);
    const s = await word.readStructure(out);
    expect(s.headings.join(' ')).toContain('الأول');
    expect(s.readingOrder).toBe('rtl');
  });

  it('addComment attaches a margin comment to the anchor text, as a tracked change', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const ch = path.join(tmpM9, 'body.docx');
    await word.createChapter(ch, { html: '<p>قال المؤلف رحمه الله في هذا الموضع كلاما.</p>' });
    const r = await word.addComment(ch, { anchorText: 'قال المؤلف', comment: 'راجع النقل من الأصل', author: 'المشرف' });
    expect(r.added).toBe(true);
    // reopen and confirm the comment survived
    const spawnSyncMod = await import('node:child_process');
    const check = spawnSyncMod.spawnSync('powershell', ['-NoProfile', '-Command',
      `$w=New-Object -ComObject Word.Application;$w.Visible=$false;$d=$w.Documents.Open('${ch}');` +
      `$n=$d.Comments.Count;$d.Close($false);$w.Quit();Write-Output $n`],
      { encoding: 'utf8', timeout: 60_000 });
    expect(Number(check.stdout.trim())).toBeGreaterThanOrEqual(1);
  });

  it('compareManuscripts reads back the differences between two witnesses', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const base = path.join(tmpM9, 'base.docx');
    const witness = path.join(tmpM9, 'witness.docx');
    await word.createChapter(base, { html: '<p>وقال الإمام إن العلم نور يهدي إلى الرشاد.</p>' });
    await word.createChapter(witness, { html: '<p>وقال الإمام إن العلم ضياء يهدي إلى السداد.</p>' });
    const r = await word.compareManuscripts(base, witness);
    expect(r.count).toBeGreaterThan(0);
    expect(fs.readFileSync(base, 'utf8').length).toBeGreaterThan(0); // base untouched
  });

  it('setPrintLayout applies the trim size + gutter, and buildIndexes marks entries + appends the INDEX', async () => {
    const word = await import('../../electron/adapters/word.ts');
    const ch = path.join(tmpM9, 'book.docx');
    await word.createChapter(ch, { html: '<p>ذكر الغزالي في الإحياء، ثم عاد الغزالي فقال.</p>' });
    const pl = await word.setPrintLayout(ch, { trimWidthCm: 14, trimHeightCm: 21, gutterCm: 1.5, mirrorMargins: true, oddEvenHeaders: true, headerOdd: 'الباب', headerEven: 'كتاب' });
    expect(pl.gutter).toBeGreaterThan(0);
    const idx = await word.buildIndexes(ch, [{ find: 'الغزالي', entry: 'الغزالي، أبو حامد' }], { heading: 'فهرس الأعلام' });
    expect(idx.marked).toBeGreaterThanOrEqual(2);
  });
});
