/**
 * M13 Phase 2 (ADR-0059) — plain text of a document anywhere on disk, for
 * `read_external_document` and `add_folder_to_library`.
 *
 *   .docx         → word/document.xml straight out of the zip (Node zlib — no
 *                   Word, no new dependency); Word as the fallback
 *   .doc/.rtf/.odt → Word (COM) export to .txt
 *   .pdf          → pdfjs-dist (already a dependency). Urdu/Arabic PDFs often
 *                   come out garbled (font encoding / visual order) — flagged,
 *                   with ocr_document as the way out
 *   .txt/.md/.csv → UTF-8
 *
 * Read-only: never writes next to the source (Word exports to os.tmpdir()).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { logger } from '../lib/logger.js';
import { UnsafePathError } from '../adapters/paths.js';
import { assertNotAppData } from './externalFiles.js';

const log = logger.child('agent/documentText');

export const READABLE_EXTS = ['.docx', '.doc', '.rtf', '.odt', '.txt', '.md', '.csv', '.pdf'] as const;
const MAX_FILE_BYTES = 80 * 1024 * 1024;

export interface DocumentText {
  text: string;
  method: 'docx-xml' | 'word' | 'pdfjs' | 'plain';
  pages?: number;
  /** A warning the scholar/model should see (e.g. garbled RTL PDF text). */
  note?: string;
}

/** Validate a document path for READING (absolute, allow-listed type, not app data). */
export function assertReadableDocument(p: unknown): string {
  if (typeof p !== 'string' || !path.isAbsolute(p)) {
    throw new UnsafePathError('give the full absolute path of the document (find it with search_my_computer)');
  }
  const abs = path.resolve(p);
  const ext = path.extname(abs).toLowerCase();
  if (!(READABLE_EXTS as readonly string[]).includes(ext)) {
    throw new UnsafePathError(`cannot read ${ext || 'extension-less'} files — only ${READABLE_EXTS.join(' ')}`);
  }
  assertNotAppData(abs);
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { throw new UnsafePathError(`file not found: ${abs}`); }
  if (!st.isFile()) throw new UnsafePathError(`not a file: ${abs}`);
  if (st.size > MAX_FILE_BYTES) throw new UnsafePathError(`file is too large to read (${Math.round(st.size / 1048576)} MB)`);
  return abs;
}

// ── .docx without Word ────────────────────────────────────────────────────

/**
 * One entry of a ZIP archive, via the central directory (so data descriptors
 * and odd local headers don't matter). Stored (0) and deflated (8) only —
 * which is all a .docx ever uses. Returns null when the entry is absent.
 */
export function readZipEntry(buf: Buffer, name: string): Buffer | null {
  // End-of-central-directory record: signature 0x06054b50, within the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`unsupported ZIP compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * WordprocessingML → text: ONLY the <w:t> runs, one line per paragraph, tabs
 * and breaks kept. Everything else (drawing offsets like <wp:posOffset>,
 * field codes, tracked deletions) is dropped, and a text box's <mc:Fallback>
 * copy is removed so it is not read twice (seen live on a real fatwa .docx).
 */
export function docxXmlToText(xml: string): string {
  const cleaned = xml
    .replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '')
    .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, '')
    .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, '');
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>|<\/w:p>/g;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = token.exec(cleaned)) !== null) {
    if (m[1] !== undefined) out += m[1];
    else if (m[0] === '<w:tab/>') out += '\t';
    else out += '\n';
  }
  return out
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e])
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── .pdf via pdfjs ─────────────────────────────────────────────────────────

/**
 * PDF text of Urdu/Arabic is often extracted in visual (reversed / reordered)
 * order. Letters that can only END a word — ے ۓ ں ة ى — then show up at the
 * START of words. Real text almost never does that; >3% of Arabic-script
 * words doing it means the extraction is garbled (tuned on a real fatwa PDF).
 */
export function looksGarbledRtl(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /[\u0600-\u06FF]/.test(w));
  if (words.length < 20) return false;
  const bad = words.filter((w) => /^[\u06D2\u06D3\u06BA\u0629\u0649]/.test(w)).length;
  return bad / words.length > 0.03;
}

async function pdfText(buf: Buffer, maxPages: number): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  const parts: string[] = [];
  const n = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    parts.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  const pages = doc.numPages;
  await task.destroy();
  return { text: parts.join('\n\n').replace(/[ \t]+/g, ' ').trim(), pages };
}

// ── entry point ───────────────────────────────────────────────────────────

export async function extractDocumentText(absPath: string, opts: { maxPdfPages?: number } = {}): Promise<DocumentText> {
  const abs = assertReadableDocument(absPath);
  const ext = path.extname(abs).toLowerCase();

  if (ext === '.txt' || ext === '.md' || ext === '.csv') {
    return { text: fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, ''), method: 'plain' };
  }

  if (ext === '.pdf') {
    const r = await pdfText(fs.readFileSync(abs), opts.maxPdfPages ?? 400);
    const note = !r.text
      ? 'This PDF has no text layer (a scan) — use ocr_document to read it.'
      : looksGarbledRtl(r.text)
        ? 'The Urdu/Arabic text of this PDF may be garbled (a common PDF font-encoding problem). If it is unreadable, use ocr_document instead.'
        : undefined;
    return { text: r.text, method: 'pdfjs', pages: r.pages, ...(note ? { note } : {}) };
  }

  if (ext === '.docx') {
    try {
      const xml = readZipEntry(fs.readFileSync(abs), 'word/document.xml');
      if (xml) return { text: docxXmlToText(xml.toString('utf8')), method: 'docx-xml' };
    } catch (err) {
      log.warn('docx XML read failed — falling back to Word', { message: (err as Error).message });
    }
  }

  // .doc / .rtf / .odt (and a .docx the XML path could not read): Word.
  const word = await import('../adapters/word.js');
  const tmp = path.join(os.tmpdir(), `easyeditor-read-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  try {
    await word.fromWord(abs, 'txt', tmp);
    return { text: fs.readFileSync(tmp, 'utf8').replace(/^\uFEFF/, ''), method: 'word' };
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
}
