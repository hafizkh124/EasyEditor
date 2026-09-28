/**
 * M13 Phase 5 (ADR-0061) — copy / move the scholar's documents into a folder
 * ("collect all my fatwa files into D:\Fatawa\2026").
 *
 * Deliberately narrow: documents only (never executables, scripts, shortcuts
 * or app data), never a delete, never an overwrite (a name clash gets
 * " (2)", " (3)" …), and every move is recorded so "Undo" can put each file
 * back exactly where it was. The scholar approves each call (dispatch.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { UnsafePathError } from '../adapters/paths.js';
import { assertNotAppData } from './externalFiles.js';
import { SEARCHABLE_EXTS } from '../host/desktopSearch.js';

export const MAX_FILES_PER_CALL = 200;

export interface FileMove { from: string; to: string; action: 'copy' | 'move' }

/** Parse the tool's `files` argument: a JSON array or one path per line. */
export function parseFileList(arg: unknown): string[] {
  let list: unknown = arg;
  if (typeof arg === 'string') {
    const t = arg.trim();
    if (t.startsWith('[')) {
      try { list = JSON.parse(t); } catch { throw new Error('files must be a JSON array of full paths, or one full path per line'); }
    } else {
      list = t.split(/\r?\n/);
    }
  }
  if (!Array.isArray(list)) throw new Error('files must be a list of full paths');
  const out = [...new Set(list.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (!out.length) throw new Error('no files given');
  if (out.length > MAX_FILES_PER_CALL) throw new Error(`at most ${MAX_FILES_PER_CALL} files per call`);
  return out;
}

/** An existing document the scholar owns. */
export function assertMovableDocument(p: string): string {
  if (!path.isAbsolute(p)) throw new UnsafePathError(`not a full path: ${p}`);
  const abs = path.resolve(p);
  const ext = path.extname(abs).toLowerCase();
  if (!(SEARCHABLE_EXTS as readonly string[]).includes(ext)) throw new UnsafePathError(`only documents can be copied or moved (not ${ext || 'extension-less'} files): ${abs}`);
  assertNotAppData(abs);
  let st: fs.Stats;
  try { st = fs.lstatSync(abs); } catch { throw new UnsafePathError(`file not found: ${abs}`); }
  if (!st.isFile() || st.isSymbolicLink()) throw new UnsafePathError(`not a regular file: ${abs}`);
  if (path.basename(abs).startsWith('~$')) throw new UnsafePathError(`that is a Word lock file: ${abs}`);
  return abs;
}

/**
 * The destination folder: absolute, not app data, and either existing or
 * creatable one level down from an existing parent (no deep surprise trees).
 */
export function resolveDestination(p: unknown): { dir: string; create: boolean } {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new UnsafePathError('give the full path of the destination folder, e.g. D:/Fatawa/2026');
  const dir = path.resolve(p);
  assertNotAppData(dir);
  if (/^[a-z]:\\?$/i.test(dir) || dir === path.parse(dir).root) throw new UnsafePathError('choose a folder, not the root of a drive');
  const sys = [process.env.SystemRoot || 'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)'].map((d) => path.resolve(d).toLowerCase());
  if (sys.some((d) => dir.toLowerCase() === d || dir.toLowerCase().startsWith(d + path.sep))) throw new UnsafePathError('refusing to write into a system folder');
  if (fs.existsSync(dir)) {
    if (!fs.statSync(dir).isDirectory()) throw new UnsafePathError(`not a folder: ${dir}`);
    return { dir, create: false };
  }
  if (!fs.existsSync(path.dirname(dir))) throw new UnsafePathError(`the parent folder does not exist: ${path.dirname(dir)}`);
  return { dir, create: true };
}

/** `name.docx` → `name (2).docx` … — the first name not taken in `dir`. */
export function freeName(dir: string, base: string, taken: Set<string> = new Set()): string {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? base : `${stem} (${i})${ext}`;
    const full = path.join(dir, name);
    if (!taken.has(full.toLowerCase()) && !fs.existsSync(full)) return full;
  }
  throw new Error(`too many files named ${base} in ${dir}`);
}

/** Plan every copy/move without touching the disk (for the approval card). */
export function planFileOps(files: string[], dest: string, action: 'copy' | 'move'): FileMove[] {
  const taken = new Set<string>();
  return files.map((f) => {
    const from = assertMovableDocument(f);
    if (path.dirname(from).toLowerCase() === dest.toLowerCase()) {
      return { from, to: from, action }; // already there — a no-op
    }
    const to = freeName(dest, path.basename(from), taken);
    taken.add(to.toLowerCase());
    return { from, to, action };
  });
}

/** Execute a plan. Never overwrites (COPYFILE_EXCL / exists check). Returns what was done. */
export function applyFileOps(plan: FileMove[], dest: { dir: string; create: boolean }): { done: FileMove[]; failed: Array<{ from: string; error: string }> } {
  if (dest.create) fs.mkdirSync(dest.dir);
  const done: FileMove[] = [];
  const failed: Array<{ from: string; error: string }> = [];
  for (const m of plan) {
    if (m.from === m.to) continue;
    try {
      if (fs.existsSync(m.to)) throw new Error('destination appeared meanwhile — skipped');
      if (m.action === 'copy') {
        fs.copyFileSync(m.from, m.to, fs.constants.COPYFILE_EXCL);
      } else {
        try {
          fs.renameSync(m.from, m.to);
        } catch (err) {
          // Across drives rename fails (EXDEV): copy, verify size, then remove the source.
          if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
          fs.copyFileSync(m.from, m.to, fs.constants.COPYFILE_EXCL);
          if (fs.statSync(m.to).size !== fs.statSync(m.from).size) throw new Error('copy size mismatch — source kept');
          fs.rmSync(m.from);
        }
      }
      done.push(m);
    } catch (err) {
      failed.push({ from: m.from, error: (err as Error).message });
    }
  }
  return { done, failed };
}

/**
 * Undo recorded moves (put each file back) and copies (remove the copy, only
 * if it is byte-identical in size to the original that still exists). A file
 * whose original location is taken again is left where it is and reported.
 */
export function undoFileOps(ops: FileMove[]): { undone: number; skipped: Array<{ path: string; reason: string }> } {
  let undone = 0;
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const m of [...ops].reverse()) {
    try {
      assertMovableDocument(m.to);
      if (m.action === 'move') {
        if (fs.existsSync(m.from)) { skipped.push({ path: m.to, reason: 'the original location is occupied again' }); continue; }
        try { fs.renameSync(m.to, m.from); } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
          fs.copyFileSync(m.to, m.from, fs.constants.COPYFILE_EXCL);
          fs.rmSync(m.to);
        }
      } else {
        if (!fs.existsSync(m.from) || fs.statSync(m.from).size !== fs.statSync(m.to).size) {
          skipped.push({ path: m.to, reason: 'the original is gone or the copy was changed — kept' });
          continue;
        }
        fs.rmSync(m.to);
      }
      undone++;
    } catch (err) {
      skipped.push({ path: m.to, reason: (err as Error).message });
    }
  }
  return { undone, skipped };
}
