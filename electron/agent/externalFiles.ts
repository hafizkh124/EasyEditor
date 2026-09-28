/**
 * M13 Phase 0 — edits to a file OUTSIDE the open project folder (ADR-0056).
 *
 * The project folder has its own safety net (`backupChapter` + task
 * checkpoints). A scholar's own `.docx` somewhere on the machine has none, so
 * every agent write to one:
 *   1. is validated here (absolute, allowlisted extension, not a system /
 *      AppData directory, not currently open in Word);
 *   2. is approved PER WRITE by the scholar (`fileApproval.ts`) — in Auto
 *      mode too; plan-level approval does not cover it;
 *   3. first copies the original to a sibling
 *      `<name>.<yyyyMMdd_HHmmss>.bak` — the scholar can see and open it in
 *      Explorer, and "Restore original" copies it back.
 *
 * Pure filesystem helpers only — no Electron import, so they are unit-testable.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { assertReadableFile, assertSafeOutputPath, UnsafePathError, type DocExt } from '../adapters/paths.js';

/** File types the agent may edit in place outside the project. */
export const EXTERNAL_EDITABLE_EXTS: readonly DocExt[] = ['.docx', '.rtf'];

/** `20260928_231500` — local time, as in the blueprint's example. */
export function backupStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** `D:\x\document.docx` → `D:\x\document.docx.20260928_231500.bak`. */
export function backupPathFor(abs: string, d: Date = new Date()): string {
  return `${abs}.${backupStamp(d)}.bak`;
}

const BACKUP_SUFFIX_RE = /\.(\d{8}_\d{6})(?:_\d+)?\.bak$/;

/** True when `backup` is a `.bak` this module would have made for `abs`. */
export function isBackupOf(abs: string, backup: string): boolean {
  const a = path.resolve(abs);
  const b = path.resolve(backup);
  if (!b.toLowerCase().startsWith(`${a.toLowerCase()}.`)) return false;
  return BACKUP_SUFFIX_RE.test(b.slice(a.length));
}

/** Directories an external edit must never target, on top of paths.ts's system dirs. */
function blockedUserDirs(): string[] {
  const dirs = [process.env.APPDATA, process.env.LOCALAPPDATA, path.join(os.homedir(), 'AppData')]
    .filter((d): d is string => typeof d === 'string' && d.length > 0);
  return [...new Set(dirs.map((d) => path.resolve(d).toLowerCase()))];
}

/** Refuse anything under the user's application-data folders (browser profiles, keys, app state). */
export function assertNotAppData(abs: string): void {
  const lower = path.resolve(abs).toLowerCase();
  for (const blocked of blockedUserDirs()) {
    if (lower === blocked || lower.startsWith(blocked + path.sep)) {
      throw new UnsafePathError(`refusing to touch an application-data file: ${abs}`);
    }
  }
}

/**
 * Word's lock ("owner") file for an open document: `~$` + the name, with the
 * first one or two characters dropped for longer names. Any `~$…` file in the
 * same folder whose tail matches means Word has the document open — editing it
 * underneath Word would either fail or be silently overwritten on Word's save.
 */
export function isOpenInWord(abs: string): boolean {
  const dir = path.dirname(abs);
  const name = path.basename(abs).toLowerCase();
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return false; }
  return entries.some((e) => {
    const l = e.toLowerCase();
    if (!l.startsWith('~$')) return false;
    const tail = l.slice(2);
    return tail.length >= 3 && name.endsWith(tail);
  });
}

/** True when `abs` resolves inside `root` (or equals it). */
export function isInsideFolder(root: string | null | undefined, abs: string): boolean {
  if (!root) return false;
  const r = path.resolve(root).toLowerCase();
  const a = path.resolve(abs).toLowerCase();
  return a === r || a.startsWith(r + path.sep);
}

/**
 * Validate an existing file the agent wants to edit in place. Returns the
 * resolved absolute path; throws {@link UnsafePathError} with a message the
 * model can relay to the scholar.
 */
export function resolveExternalTarget(p: unknown, allowed: readonly DocExt[] = EXTERNAL_EDITABLE_EXTS): string {
  if (typeof p !== 'string' || !path.isAbsolute(p)) {
    throw new UnsafePathError('an outside file must be given as a full absolute path (e.g. D:\\Books\\x.docx) — use search_my_computer to find it');
  }
  const abs = assertReadableFile(p, allowed as string[]);
  // Re-uses the system-directory + parent-dir checks of the write guard.
  assertSafeOutputPath(abs, allowed);
  assertNotAppData(abs);
  if (path.basename(abs).startsWith('~$')) {
    throw new UnsafePathError('that is Word\'s temporary lock file, not a document');
  }
  if (isOpenInWord(abs)) {
    throw new UnsafePathError(`"${path.basename(abs)}" is open in Word right now — ask the scholar to save and close it first, then try again`);
  }
  return abs;
}

/**
 * Copy `abs` to a fresh sibling `.bak` (never overwriting an existing one —
 * two edits in the same second get a `_2` suffix). Returns the backup path.
 */
export function backupBeside(abs: string, d: Date = new Date()): string {
  const base = backupPathFor(abs, d);
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : base.replace(/\.bak$/, `_${i}.bak`);
    try {
      fs.copyFileSync(abs, candidate, fs.constants.COPYFILE_EXCL);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`could not create a backup beside ${abs}`);
}

/**
 * "Restore original" — copy the `.bak` back over the edited file. The backup
 * itself is kept (the scholar can delete it). Only a backup this module made
 * for exactly this file is accepted.
 */
export function restoreFromBackup(abs: string, backup: string): { restored: string } {
  if (!path.isAbsolute(abs) || !path.isAbsolute(backup)) throw new UnsafePathError('restore needs absolute paths');
  if (!isBackupOf(abs, backup)) throw new UnsafePathError('that backup does not belong to this file');
  if (!fs.existsSync(backup)) throw new UnsafePathError(`backup not found: ${backup}`);
  if (isOpenInWord(abs)) {
    throw new UnsafePathError(`"${path.basename(abs)}" is open in Word — close it first, then restore`);
  }
  fs.copyFileSync(backup, abs);
  return { restored: path.resolve(abs) };
}

/** One outside-file edit made during a run — surfaced on the result for "Restore original". */
export interface ExternalEdit {
  path: string;
  backup: string;
  ops: string[];
}
