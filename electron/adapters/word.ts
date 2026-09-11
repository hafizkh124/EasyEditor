/**
 * M8 Layer 2 — the Microsoft Word adapter (SPEC-M8 §3 "Layer 2", ADR-0017).
 *
 * The deepest adapter, and the template every later one follows: it declares
 * its formats/ops via an {@link AdapterDescriptor}, reports whether Word is
 * present on this machine, and implements each operation as an op sequence
 * over the Layer 1 `WordHost` — no PowerShell strings, every path validated
 * (electron/adapters/paths.ts), every document session serialised
 * (`runExclusive`, for COM re-entrancy safety).
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { logger } from '../lib/logger.js';
import {
  getWordHost,
  refreshOwnedWord,
  runExclusive,
  detectTools,
} from '../host/index.js';
import type {
  HostReply,
  ReadStructureReply,
  InstallFontReply,
  ApplyCitationsReply,
  InstallTemplateReply,
  GlobalOptionReply,
  CompareIntoReply,
  CreateDocumentReply,
  AddCommentReply,
  ReadRevisionsReply,
  MarkIndexEntriesReply,
} from '../host/types.js';
import type { CitationFootnote } from '../../shared/convert/citationFootnotes.js';
import type {
  AdapterDescriptor,
  AdapterAvailability,
  DocStructure,
} from '../../shared/adapters/types.js';
import { assertSafeOutputPath, assertReadableFile, type DocExt } from './paths.js';

const log = logger.child('adapters/word');

/** Formats Word's `Documents.Open` can actually load as a source. */
const OPENABLE: DocExt[] = ['.docx', '.rtf', '.html', '.htm', '.txt'];

export const wordDescriptor: AdapterDescriptor = {
  id: 'word',
  label: 'Microsoft Word',
  reads: [
    { format: 'docx', quality: 1 },
    { format: 'rtf', quality: 0.9 },
    { format: 'html', quality: 0.75 },
    { format: 'txt', quality: 0.6 },
    { format: 'pdf', quality: 0.5, lossy: 'Exact page layout is lost; large PDFs are slow (≈23 s+ per document).' },
  ],
  writes: [
    { format: 'docx', quality: 1 },
    { format: 'pdf', quality: 0.95 },
    { format: 'rtf', quality: 0.9 },
    { format: 'html', quality: 0.7, lossy: 'Word HTML is verbose; some character styling is simplified.' },
    { format: 'txt', quality: 0.4, lossy: 'All formatting, footnotes, and images are dropped.' },
  ],
  ops: [
    'toWord', 'fromWord', 'reflowPdf', 'readStructure', 'installFont', 'applyCitations', 'installTemplate', 'setGlobalOption',
    // M9 Phase 2
    'createChapter', 'addComment', 'compareManuscripts', 'setPrintLayout', 'buildIndexes',
  ],
  platforms: ['win32'],
};

/** Whether Word automation works on this machine right now. */
export function available(): AdapterAvailability {
  const t = detectTools();
  return t.word
    ? { available: true, version: t.wordVersion }
    : { available: false, version: null, reason: t.reason ?? 'Microsoft Word is not available.' };
}

export interface ToWordOptions {
  /** Apply the RTL page setup (margins + reading order) before saving. */
  rtlPageSetup?: boolean;
  /** Turn Track Changes on in the produced document. */
  trackChanges?: boolean;
}

const EXT_FOR: Record<'docx' | 'pdf' | 'rtf' | 'html' | 'txt', DocExt> = {
  docx: '.docx', pdf: '.pdf', rtf: '.rtf', html: '.html', txt: '.txt',
};

/**
 * EasyEditor content (HTML from the editor, or any Word-openable source file)
 * → a document in `to`. Word opens the source, options are applied, then it is
 * exported. `to === 'docx'` uses SaveAs; the rest use Word's own export.
 */
export async function exportDocument(
  input: { sourcePath?: string; html?: string },
  to: 'docx' | 'pdf' | 'rtf' | 'html' | 'txt',
  outputPath: string,
  opts: ToWordOptions = {},
): Promise<{ outputPath: string; ms: number }> {
  const out = assertSafeOutputPath(outputPath, [EXT_FOR[to]]);
  let tempHtml: string | null = null;
  let source: string;

  if (input.html != null) {
    tempHtml = path.join(os.tmpdir(), `easyeditor-export-${Date.now()}.html`);
    fs.writeFileSync(
      tempHtml,
      `<!doctype html><html><head><meta charset="utf-8"></head><body>${input.html}</body></html>`,
      'utf8',
    );
    source = tempHtml;
  } else if (input.sourcePath) {
    source = assertReadableFile(input.sourcePath, OPENABLE);
  } else {
    throw new Error('exportDocument: provide either `html` or `sourcePath`');
  }

  const started = Date.now();
  try {
    await runExclusive(async () => {
      const h = getWordHost();
      await h.sendOk({ op: 'open', path: source });
      await refreshOwnedWord();
      if (opts.trackChanges) await h.sendOk({ op: 'setTrackRevisions', enabled: true });
      if (opts.rtlPageSetup) await h.sendOk({ op: 'setRtlPageSetup' });
      if (to === 'docx') await h.sendOk({ op: 'saveAs', path: out });
      else await h.sendOk({ op: 'exportAs', path: out, format: to });
      await h.sendOk({ op: 'close' });
    });
    return { outputPath: out, ms: Date.now() - started };
  } finally {
    if (tempHtml) { try { fs.rmSync(tempHtml, { force: true }); } catch { /* ignore */ } }
  }
}

/** `exportDocument(..., 'docx', ...)` — kept as a named entry point. */
export function toWord(
  input: { sourcePath?: string; html?: string },
  outputPath: string,
  opts: ToWordOptions = {},
): Promise<{ outputPath: string; ms: number }> {
  return exportDocument(input, 'docx', outputPath, opts);
}

/** `.docx` (or any openable source) → pdf / rtf / html / txt via Word's own export. */
export async function fromWord(
  sourcePath: string,
  to: 'pdf' | 'rtf' | 'html' | 'txt',
  outputPath: string,
): Promise<{ outputPath: string; ms: number }> {
  const src = assertReadableFile(sourcePath, OPENABLE);
  const out = assertSafeOutputPath(outputPath, [`.${to}` as DocExt]);
  const started = Date.now();
  await runExclusive(async () => {
    const h = getWordHost();
    await h.sendOk({ op: 'open', path: src });
    await refreshOwnedWord();
    await h.sendOk({ op: 'exportAs', path: out, format: to });
    await h.sendOk({ op: 'close' });
  });
  return { outputPath: out, ms: Date.now() - started };
}

/**
 * `.pdf` (text layer) → `.docx` via Word's built-in reflow. Slow — the P0
 * spike measured ~23 s for a short document — so `onProgress` is called at
 * the phase boundaries.
 */
export async function reflowPdf(
  pdfPath: string,
  outputPath: string,
  onProgress?: (p: { phase: string; percent: number }) => void,
): Promise<{ outputPath: string; wordCount: number; ms: number }> {
  const src = assertReadableFile(pdfPath, ['.pdf']);
  const out = assertSafeOutputPath(outputPath, ['.docx']);
  const started = Date.now();
  let wordCount = 0;
  await runExclusive(async () => {
    const h = getWordHost();
    onProgress?.({ phase: 'reflowing', percent: 10 });
    const r = await h.sendOk<HostReply & { wordCount: number }>({ op: 'openPdfReflow', path: src });
    wordCount = r.wordCount ?? 0;
    await refreshOwnedWord();
    onProgress?.({ phase: 'saving', percent: 80 });
    await h.sendOk({ op: 'saveAs', path: out });
    await h.sendOk({ op: 'close' });
    onProgress?.({ phase: 'done', percent: 100 });
  });
  return { outputPath: out, wordCount, ms: Date.now() - started };
}

/**
 * P6 — insert EasyEditor's verified citations as real Word footnotes at each
 * `[N]` marker in the document. `footnotes` comes from
 * `buildCitationFootnotes()` (shared), which builds each footnote's text from
 * the verified sources array — this adapter only places what it is given.
 * Refuses if nothing would be inserted.
 */
export async function applyCitations(
  input: { sourcePath?: string; html?: string },
  footnotes: CitationFootnote[],
  outputPath: string,
  opts: ToWordOptions & { stripMarkers?: boolean } = {},
): Promise<{ outputPath: string; applied: number; notFound: string[]; ms: number }> {
  const clean = footnotes.filter((f) => f && f.marker.trim() && f.text.trim());
  if (clean.length === 0) throw new Error('applyCitations: no usable footnotes');

  const out = assertSafeOutputPath(outputPath, ['.docx']);
  let tempHtml: string | null = null;
  let source: string;
  if (input.html != null) {
    tempHtml = path.join(os.tmpdir(), `easyeditor-cite-${Date.now()}.html`);
    fs.writeFileSync(tempHtml, `<!doctype html><html><head><meta charset="utf-8"></head><body>${input.html}</body></html>`, 'utf8');
    source = tempHtml;
  } else if (input.sourcePath) {
    source = assertReadableFile(input.sourcePath, OPENABLE);
  } else {
    throw new Error('applyCitations: provide either `html` or `sourcePath`');
  }

  const started = Date.now();
  let applied = 0;
  let notFound: string[] = [];
  try {
    await runExclusive(async () => {
      const h = getWordHost();
      await h.sendOk({ op: 'open', path: source });
      await refreshOwnedWord();
      if (opts.trackChanges) await h.sendOk({ op: 'setTrackRevisions', enabled: true });
      if (opts.rtlPageSetup) await h.sendOk({ op: 'setRtlPageSetup' });
      const r = await h.sendOk<ApplyCitationsReply>({
        op: 'applyCitations',
        footnotes: clean.map((f) => ({ marker: f.marker, text: f.text })),
        stripMarkers: opts.stripMarkers ?? false,
      });
      applied = r.applied ?? 0;
      notFound = r.notFound ?? [];
      await h.sendOk({ op: 'saveAs', path: out });
      await h.sendOk({ op: 'close' });
    });
    return { outputPath: out, applied, notFound, ms: Date.now() - started };
  } finally {
    if (tempHtml) { try { fs.rmSync(tempHtml, { force: true }); } catch { /* ignore */ } }
  }
}

/**
 * Apply the RTL page setup to an existing chapter file IN PLACE, as a tracked
 * change (M8 agent `set_page_layout`). The file is opened, edited, and saved
 * back to the same path — not regenerated.
 */
export async function setChapterLayout(chapterPath: string): Promise<{ ms: number }> {
  const src = assertReadableFile(chapterPath, OPENABLE);
  const out = assertSafeOutputPath(chapterPath, ['.docx']);
  const started = Date.now();
  await runExclusive(async () => {
    const h = getWordHost();
    await h.sendOk({ op: 'open', path: src });
    await refreshOwnedWord();
    await h.sendOk({ op: 'setTrackRevisions', enabled: true });
    await h.sendOk({ op: 'setRtlPageSetup' });
    await h.sendOk({ op: 'saveAs', path: out });
    await h.sendOk({ op: 'close' });
  });
  return { ms: Date.now() - started };
}

/** The Word application options the agent may touch (SPEC-M8 §3 gate #5). */
export const ALLOWED_GLOBAL_OPTIONS = {
  check_spelling: 'CheckSpellingAsYouType',
  check_grammar: 'CheckGrammarAsYouType',
  smart_quotes: 'AutoFormatAsYouTypeReplaceQuotes',
} as const;
export type GlobalOptionKey = keyof typeof ALLOWED_GLOBAL_OPTIONS;

/**
 * P9 — install a Word template per-user, and (optionally) attach it to a
 * chapter as a tracked change so its styles apply. The template is a file the
 * scholar chose; nothing is downloaded.
 */
export async function installTemplate(
  templatePath: string,
  opts: { chapterPath?: string } = {},
): Promise<{ templateName: string; installedTo: string; attachedTo?: string; ms: number }> {
  const src = assertReadableFile(templatePath, ['.dotx', '.dotm']);
  const chapter = opts.chapterPath ? assertReadableFile(opts.chapterPath, OPENABLE) : null;
  const started = Date.now();
  let templateName = '';
  let installedTo = '';
  await runExclusive(async () => {
    const h = getWordHost();
    const r = await h.sendOk<InstallTemplateReply>({ op: 'installTemplate', path: src });
    templateName = r.templateName;
    installedTo = r.dest;
    await refreshOwnedWord();
    if (chapter) {
      await h.sendOk({ op: 'open', path: chapter });
      await h.sendOk({ op: 'setTrackRevisions', enabled: true });
      await h.sendOk({ op: 'attachTemplate', path: installedTo });
      await h.sendOk({ op: 'saveAs', path: chapter });
      await h.sendOk({ op: 'close' });
    }
  });
  return { templateName, installedTo, ...(chapter ? { attachedTo: chapter } : {}), ms: Date.now() - started };
}

/** P9 — read one allow-listed Word Application option ('true' | 'false'). */
export async function getWordOption(key: GlobalOptionKey): Promise<string> {
  const name = ALLOWED_GLOBAL_OPTIONS[key];
  if (!name) throw new Error(`unknown global option: ${key}`);
  return runExclusive(async () => {
    const h = getWordHost();
    const r = await h.sendOk<GlobalOptionReply>({ op: 'getGlobalOption', name });
    await refreshOwnedWord();
    return r.value;
  });
}

/** P9 — set one allow-listed Word Application option. Consent is the caller's job. */
export async function setWordOption(key: GlobalOptionKey, value: 'true' | 'false'): Promise<string> {
  const name = ALLOWED_GLOBAL_OPTIONS[key];
  if (!name) throw new Error(`unknown global option: ${key}`);
  return runExclusive(async () => {
    const h = getWordHost();
    const r = await h.sendOk<GlobalOptionReply>({ op: 'setGlobalOption', name, value });
    await refreshOwnedWord();
    return r.value;
  });
}

/**
 * P9 (agent `run_task`) — apply a wholesale text/HTML rewrite to a chapter as
 * real Word tracked changes. The revised content is written to a temp file,
 * turned into a `.docx`, then diffed against the original with Word's own
 * `Compare` — so the scholar reviews genuine revisions, not a delete-all +
 * insert-all. The chapter file is overwritten only with the comparison result.
 */
export async function applyTextTask(
  chapterPathArg: string,
  refined: string,
  opts: { isHtml: boolean },
): Promise<{ revisions: number; ms: number }> {
  const dest = assertSafeOutputPath(chapterPathArg, ['.docx']);
  assertReadableFile(chapterPathArg, OPENABLE); // the chapter must already exist
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempSrc = path.join(os.tmpdir(), `easyeditor-task-${stamp}${opts.isHtml ? '.html' : '.txt'}`);
  const tempRevised = path.join(os.tmpdir(), `easyeditor-task-${stamp}.docx`);
  const tempCompared = path.join(os.tmpdir(), `easyeditor-task-${stamp}-cmp.docx`);
  fs.writeFileSync(
    tempSrc,
    opts.isHtml
      ? `<!doctype html><html><head><meta charset="utf-8"></head><body>${refined}</body></html>`
      : refined,
    'utf8',
  );

  const started = Date.now();
  let revisions = 0;
  try {
    await runExclusive(async () => {
      const h = getWordHost();
      // 1 — build the revised .docx from the model's output
      await h.sendOk({ op: 'open', path: tempSrc });
      await refreshOwnedWord();
      await h.sendOk({ op: 'saveAs', path: tempRevised });
      await h.sendOk({ op: 'close' });
      // 2 — diff the original against it; the comparison result carries the revisions
      await h.sendOk({ op: 'open', path: dest });
      const r = await h.sendOk<CompareIntoReply>({ op: 'compareInto', revisedPath: tempRevised, outPath: tempCompared });
      revisions = r.revisions ?? 0;
      await h.sendOk({ op: 'close' });
    });
    // 3 — replace the chapter with the tracked-change version
    fs.copyFileSync(tempCompared, dest);
    return { revisions, ms: Date.now() - started };
  } finally {
    for (const p of [tempSrc, tempRevised, tempCompared]) {
      try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
    }
  }
}

/** Inspect a document's structure — the `.docx` → EasyEditor doc side. */
export async function readStructure(docxPath: string): Promise<DocStructure> {
  const src = assertReadableFile(docxPath, OPENABLE);
  return runExclusive(async () => {
    const h = getWordHost();
    await h.sendOk({ op: 'open', path: src });
    await refreshOwnedWord();
    try {
      const r = await h.sendOk<ReadStructureReply>({ op: 'readStructure' });
      return {
        headings: r.headings ?? [],
        footnotes: r.footnotes ?? [],
        trackedChanges: r.trackedChanges ?? 0,
        wordCount: r.wordCount ?? 0,
        readingOrder: r.readingOrder ?? 'mixed',
      };
    } finally {
      await h.send({ op: 'close' });
    }
  });
}

/**
 * Install a font per-user so a *running* Word sees it (P0 proof 5 / constraint
 * 2: file copy + registry alone is not enough — the host op does
 * AddFontResourceW + WM_FONTCHANGE). Verifies via `installFontCheck` and only
 * asks for a Word restart if that verification fails.
 */
export async function installFont(
  fontPath: string,
): Promise<{ fontName: string; verified: boolean; note?: string }> {
  const src = assertReadableFile(fontPath, ['.ttf', '.otf', '.ttc']);
  return runExclusive(async () => {
    const h = getWordHost();
    const r = await h.sendOk<InstallFontReply>({ op: 'installFont', path: src });
    await refreshOwnedWord();
    const verified = r.verifiedInRunningWord === true;
    log.debug('installFont', { fontName: r.fontName, verified });
    return {
      fontName: r.fontName,
      verified,
      ...(verified ? {} : { note: 'Font installed, but not yet visible to Word — restart Word to use it.' }),
    };
  });
}

// ── M9 Phase 2 ────────────────────────────────────────────────────────────

/** Create a new chapter `.docx` — blank, or from an HTML fragment. */
export async function createChapter(
  destPath: string,
  opts: { html?: string; rtl?: boolean } = {},
): Promise<{ outputPath: string; name: string; ms: number }> {
  const out = assertSafeOutputPath(destPath, ['.docx']);
  let tempHtml: string | null = null;
  if (opts.html != null) {
    tempHtml = path.join(os.tmpdir(), `easyeditor-newchapter-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    fs.writeFileSync(tempHtml, `<!doctype html><html><head><meta charset="utf-8"></head><body>${opts.html}</body></html>`, 'utf8');
  }
  const started = Date.now();
  let name = path.basename(out);
  try {
    await runExclusive(async () => {
      const h = getWordHost();
      const r = await h.sendOk<CreateDocumentReply>({
        op: 'createDocument', path: out, sourcePath: tempHtml ?? undefined, rtl: opts.rtl ?? true,
      });
      name = r.name ?? name;
      await refreshOwnedWord();
      await h.sendOk({ op: 'close' });
    });
    return { outputPath: out, name, ms: Date.now() - started };
  } finally {
    if (tempHtml) { try { fs.rmSync(tempHtml, { force: true }); } catch { /* ignore */ } }
  }
}

/** Attach a margin comment to the first occurrence of `anchorText`, as a tracked change. */
export async function addComment(
  chapterPathArg: string,
  opts: { anchorText: string; comment: string; author?: string },
): Promise<{ added: boolean; notFound: boolean; ms: number }> {
  const dest = assertSafeOutputPath(chapterPathArg, ['.docx']);
  assertReadableFile(chapterPathArg, OPENABLE);
  const started = Date.now();
  let added = false;
  let notFound = false;
  await runExclusive(async () => {
    const h = getWordHost();
    await h.sendOk({ op: 'open', path: dest });
    await refreshOwnedWord();
    try {
      await h.sendOk({ op: 'setTrackRevisions', enabled: true });
      const r = await h.sendOk<AddCommentReply>({
        op: 'addComment', anchorText: opts.anchorText, text: opts.comment, author: opts.author,
      });
      added = r.added === true;
      notFound = r.notFound === true;
      if (added) await h.sendOk({ op: 'save' });
    } finally {
      await h.send({ op: 'close' });
    }
  });
  return { added, notFound, ms: Date.now() - started };
}

/**
 * Diff a base chapter against a witness with Word's Compare, then read back
 * every revision — the raw material for an apparatus criticus
 * (compare_manuscript_variants). Neither input file is modified.
 */
export async function compareManuscripts(
  basePathArg: string,
  witnessPathArg: string,
): Promise<{ revisions: ReadRevisionsReply['revisions']; count: number; ms: number }> {
  const base = assertReadableFile(basePathArg, OPENABLE);
  const witness = assertReadableFile(witnessPathArg, OPENABLE);
  const tempCompared = path.join(os.tmpdir(), `easyeditor-apparatus-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`);
  const started = Date.now();
  let revisions: ReadRevisionsReply['revisions'] = [];
  try {
    await runExclusive(async () => {
      const h = getWordHost();
      await h.sendOk({ op: 'open', path: base });
      await refreshOwnedWord();
      await h.sendOk<CompareIntoReply>({ op: 'compareInto', revisedPath: witness, outPath: tempCompared });
      await h.sendOk({ op: 'close' });
      await h.sendOk({ op: 'open', path: tempCompared });
      const r = await h.sendOk<ReadRevisionsReply>({ op: 'readRevisions' });
      revisions = r.revisions ?? [];
      await h.send({ op: 'close' });
    });
    return { revisions, count: revisions.length, ms: Date.now() - started };
  } finally {
    try { fs.rmSync(tempCompared, { force: true }); } catch { /* ignore */ }
  }
}

export interface PrintLayoutOptions {
  trimWidthCm: number;
  trimHeightCm: number;
  gutterCm?: number;
  mirrorMargins?: boolean;
  oddEvenHeaders?: boolean;
  differentFirstPage?: boolean;
  startRecto?: boolean;
  headerOdd?: string;
  headerEven?: string;
  // M12 Phase E (ADR-0050) — the PowerShell op has always accepted these
  // (setPrintLayout, M11 Phase 4); nothing on the TS side ever sent them.
  marginTopCm?: number;
  marginBottomCm?: number;
  marginLeftCm?: number;
  marginRightCm?: number;
  lineSpacingPt?: number;
}

/** Apply print-ready page geometry to a chapter, in place. Not a tracked change (page setup is not a revision). */
export async function setPrintLayout(chapterPathArg: string, opts: PrintLayoutOptions): Promise<{ pageWidth: number; pageHeight: number; gutter: number; ms: number }> {
  const dest = assertSafeOutputPath(chapterPathArg, ['.docx']);
  assertReadableFile(chapterPathArg, OPENABLE);
  const started = Date.now();
  let out = { pageWidth: 0, pageHeight: 0, gutter: 0 };
  await runExclusive(async () => {
    const h = getWordHost();
    await h.sendOk({ op: 'open', path: dest });
    await refreshOwnedWord();
    try {
      const r = await h.sendOk<HostReply & { pageWidth: number; pageHeight: number; gutter: number }>({
        op: 'setPrintLayout',
        pageWidthCm: opts.trimWidthCm,
        pageHeightCm: opts.trimHeightCm,
        gutterCm: opts.gutterCm,
        mirrorMargins: opts.mirrorMargins,
        oddEven: opts.oddEvenHeaders,
        differentFirstPage: opts.differentFirstPage,
        startRecto: opts.startRecto,
        headerOdd: opts.headerOdd,
        headerEven: opts.headerEven,
        marginTopCm: opts.marginTopCm,
        marginBottomCm: opts.marginBottomCm,
        marginLeftCm: opts.marginLeftCm,
        marginRightCm: opts.marginRightCm,
        lineSpacingPt: opts.lineSpacingPt,
      });
      out = { pageWidth: r.pageWidth ?? 0, pageHeight: r.pageHeight ?? 0, gutter: r.gutter ?? 0 };
      await h.sendOk({ op: 'save' });
    } finally {
      await h.send({ op: 'close' });
    }
  });
  return { ...out, ms: Date.now() - started };
}

/**
 * Mark every occurrence of each index term with a Word XE field, then append
 * the INDEX field so Word builds the index (build_scholarly_indexes).
 */
export async function buildIndexes(
  chapterPathArg: string,
  entries: Array<{ find: string; entry: string }>,
  opts: { heading?: string } = {},
): Promise<{ marked: number; ms: number }> {
  const dest = assertSafeOutputPath(chapterPathArg, ['.docx']);
  assertReadableFile(chapterPathArg, OPENABLE);
  const clean = entries.filter((e) => e && e.find.trim() && e.entry.trim());
  if (clean.length === 0) throw new Error('buildIndexes: no usable index entries');
  const started = Date.now();
  let marked = 0;
  await runExclusive(async () => {
    const h = getWordHost();
    await h.sendOk({ op: 'open', path: dest });
    await refreshOwnedWord();
    try {
      const r = await h.sendOk<MarkIndexEntriesReply>({ op: 'markIndexEntries', entries: clean });
      marked = r.marked ?? 0;
      await h.sendOk({ op: 'appendIndex', field: 'INDEX', heading: opts.heading });
      await h.sendOk({ op: 'save' });
    } finally {
      await h.send({ op: 'close' });
    }
  });
  return { marked, ms: Date.now() - started };
}
