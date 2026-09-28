/**
 * M13 Phase 2 (ADR-0059) — add a folder of the scholar's books to the local
 * research library, so `search_corpus` finds passages in them by keyword AND
 * by meaning (the sqlite-vec index).
 *
 * Each document's text is extracted locally (documentText.ts) and stored as
 * the item's pre-extracted text; the existing ingest pipeline then chunks and
 * embeds it. Embedding sends the text to Gemini — the dispatcher asks the
 * scholar first (per call), naming the files.
 *
 * Idempotent: a file already in the library with the same size + mtime is
 * skipped; a changed one is replaced. Bounded per call (`maxFiles`) — the
 * result says how many remain so the agent/scholar can continue.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { extractDocumentText } from './documentText.js';
import { assertNotAppData } from './externalFiles.js';

const log = logger.child('agent/folderIngest');

export const INGESTABLE_EXTS = new Set(['.pdf', '.docx', '.doc', '.rtf', '.odt', '.txt', '.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.easyeditor', '$recycle.bin', 'system volume information']);
const MIN_TEXT_CHARS = 200;

export interface FolderFile { path: string; size: number; mtimeMs: number }

/** Minimal slice of WorkspaceDbService this module needs (injectable for tests). */
export interface LibraryPort {
  findLocalDocumentItem(localPath: string): Promise<{ id: string; size?: number; mtimeMs?: number; done: boolean } | null>;
  createItem(item: { title: string; kind: string; source_ref: Record<string, unknown>; meta: Record<string, unknown> }): Promise<{ id: string }>;
  deleteItem(id: string): Promise<void>;
  ingestLibraryItem(args: { itemId: string; offset?: number; batchSize?: number; signal?: { aborted: boolean } }): Promise<{ next_offset: number; done: boolean; total_chunks: number }>;
}

/** Validate a folder the scholar named: absolute, existing, not app data. */
export function resolveLibraryFolder(p: unknown): string {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('give the full path of the folder, e.g. D:/Books');
  const abs = path.resolve(p);
  assertNotAppData(abs);
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { throw new Error(`folder not found: ${abs}`); }
  if (!st.isDirectory()) throw new Error(`not a folder: ${abs}`);
  return abs;
}

/** Every ingestable document under `folder` (recursive, bounded). */
export function listFolderDocuments(folder: string, max = 5_000): FolderFile[] {
  const out: FolderFile[] = [];
  const queue = [folder];
  while (queue.length && out.length < max) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('.')) queue.push(full);
      } else if (e.isFile() && !e.name.startsWith('~$') && INGESTABLE_EXTS.has(path.extname(e.name).toLowerCase())) {
        try {
          const st = fs.statSync(full);
          out.push({ path: full, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
        } catch { /* vanished */ }
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Split the folder into files to add (new or changed) and files already current. */
export async function planFolderIngest(files: FolderFile[], lib: LibraryPort): Promise<{ todo: Array<FolderFile & { replaceId?: string }>; current: number }> {
  const todo: Array<FolderFile & { replaceId?: string }> = [];
  let current = 0;
  for (const f of files) {
    const existing = await lib.findLocalDocumentItem(f.path);
    if (!existing) { todo.push(f); continue; }
    if (existing.done && existing.size === f.size && existing.mtimeMs === f.mtimeMs) { current++; continue; }
    todo.push({ ...f, replaceId: existing.id });
  }
  return { todo, current };
}

export interface IngestFileResult { path: string; status: 'added' | 'skipped' | 'failed'; chunks?: number; reason?: string }

/** Extract + create + embed each file in turn. Stops early on cancel. */
export async function ingestFolderFiles(
  files: Array<FolderFile & { replaceId?: string }>,
  lib: LibraryPort,
  opts: { isCancelled?: () => boolean; onFile?: (i: number, r: IngestFileResult) => void } = {},
): Promise<IngestFileResult[]> {
  const results: IngestFileResult[] = [];
  const signal = { aborted: false };
  for (let i = 0; i < files.length; i++) {
    if (opts.isCancelled?.()) { signal.aborted = true; break; }
    const f = files[i];
    let r: IngestFileResult;
    try {
      const doc = await extractDocumentText(f.path);
      const text = doc.text.trim();
      if (text.length < MIN_TEXT_CHARS) {
        r = { path: f.path, status: 'skipped', reason: doc.note ?? 'no readable text' };
      } else if (doc.note && /garbled/.test(doc.note)) {
        // Embedding garbled Urdu/Arabic would only pollute the index.
        r = { path: f.path, status: 'skipped', reason: 'the PDF text is garbled — OCR it first (ocr_document)' };
      } else {
        if (f.replaceId) await lib.deleteItem(f.replaceId);
        const item = await lib.createItem({
          title: path.basename(f.path, path.extname(f.path)),
          kind: 'book',
          source_ref: { localPath: f.path, size: f.size, mtimeMs: f.mtimeMs, origin: 'folder' },
          meta: { ingest: { status: 'embedding', progress: 0, extracted_text: text } },
        });
        let offset = 0;
        let total = 0;
        for (;;) {
          if (opts.isCancelled?.()) signal.aborted = true;
          const b = await lib.ingestLibraryItem({ itemId: item.id, offset, batchSize: 50, signal });
          total = b.total_chunks;
          if (b.done || signal.aborted || b.next_offset <= offset) break;
          offset = b.next_offset;
        }
        r = signal.aborted
          ? { path: f.path, status: 'failed', reason: 'cancelled — run again to finish (already-embedded chunks are kept)' }
          : { path: f.path, status: 'added', chunks: total };
      }
    } catch (err) {
      log.warn('folder ingest: file failed', { path: f.path, message: (err as Error).message });
      r = { path: f.path, status: 'failed', reason: (err as Error).message.slice(0, 200) };
    }
    results.push(r);
    try { opts.onFile?.(i, r); } catch { /* UI only */ }
    if (signal.aborted) break;
  }
  return results;
}
