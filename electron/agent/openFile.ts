/**
 * M13 (ADR-0056) — open a document in its default app (Word, Acrobat, …).
 *
 * Used by the "Open in Word" button after an outside-file edit and by the
 * `open_file` agent tool. Only document extensions are allowed — never an
 * executable, script, shortcut or installer — so a path from a model or a web
 * page can never become "run this program".
 */
import path from 'node:path';
import fs from 'node:fs';
import { shell } from 'electron';

export const OPENABLE_DOC_EXTS = new Set([
  '.docx', '.doc', '.rtf', '.odt', '.pdf', '.txt', '.md',
  '.xlsx', '.xls', '.csv', '.pptx', '.ppt', '.epub', '.bak',
]);

export function assertOpenableDoc(p: unknown): string {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('open needs an absolute file path');
  const abs = path.resolve(p);
  const ext = path.extname(abs).toLowerCase();
  if (!OPENABLE_DOC_EXTS.has(ext)) throw new Error(`refusing to open a ${ext || 'extension-less'} file — only documents can be opened`);
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { throw new Error(`file not found: ${abs}`); }
  if (!st.isFile()) throw new Error(`not a file: ${abs}`);
  return abs;
}

/** Open a validated document in its default application. */
export async function openDocument(p: unknown): Promise<{ opened: string }> {
  const abs = assertOpenableDoc(p);
  // `.bak` has no default app — open it with the original's handler by
  // showing it in Explorer instead.
  if (abs.toLowerCase().endsWith('.bak')) {
    shell.showItemInFolder(abs);
    return { opened: abs };
  }
  const err = await shell.openPath(abs);
  if (err) throw new Error(err);
  return { opened: abs };
}
