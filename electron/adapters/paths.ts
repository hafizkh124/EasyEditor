import path from 'node:path';
import fs from 'node:fs';

/**
 * M8 Layer 2 path guards (SPEC-M8 §3 "Security gates" #2).
 *
 * P2 has no project folder yet (that lands in P7), so the boundary here is
 * narrower: an output path must be absolute, normalised, carry an
 * allowlisted extension, and not resolve onto a Windows/system directory.
 * P7's `fileBackend` tightens this to "must be inside the open project
 * folder"; keep new callers going through these helpers so that tightening
 * is one edit.
 */

export type DocExt = '.docx' | '.pdf' | '.rtf' | '.html' | '.htm' | '.txt' | '.md';

const DEFAULT_ALLOWED: DocExt[] = ['.docx', '.pdf', '.rtf', '.html', '.htm', '.txt', '.md'];

/** Directories a generated file must never be written into. */
const BLOCKED_PREFIXES = [
  process.env.SystemRoot || 'C:\\Windows',
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
  'C:\\Program Files',
  'C:\\Program Files (x86)',
].map((p) => path.resolve(p).toLowerCase());

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

/**
 * Validates a path the bridge is about to WRITE. Returns the normalised
 * absolute path. Throws {@link UnsafePathError} on anything suspicious.
 */
export function assertSafeOutputPath(
  p: unknown,
  allowed: readonly DocExt[] = DEFAULT_ALLOWED,
): string {
  if (typeof p !== 'string' || p.trim() === '') {
    throw new UnsafePathError('output path must be a non-empty string');
  }
  if (p.includes('\0')) {
    throw new UnsafePathError('output path contains a null byte');
  }
  if (!path.isAbsolute(p)) {
    throw new UnsafePathError(`output path must be absolute: ${p}`);
  }
  const resolved = path.resolve(p);
  const ext = path.extname(resolved).toLowerCase() as DocExt;
  if (!allowed.includes(ext)) {
    throw new UnsafePathError(`output extension ${ext || '(none)'} is not allowed (allowed: ${allowed.join(', ')})`);
  }
  const lower = resolved.toLowerCase();
  for (const blocked of BLOCKED_PREFIXES) {
    if (lower === blocked || lower.startsWith(blocked + path.sep)) {
      throw new UnsafePathError(`refusing to write into a system directory: ${resolved}`);
    }
  }
  // The parent directory must already exist and be a real directory (no
  // writing through a dangling symlink or into a file-as-directory).
  const dir = path.dirname(resolved);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    throw new UnsafePathError(`output directory does not exist: ${dir}`);
  }
  if (stat.isSymbolicLink()) {
    throw new UnsafePathError(`output directory is a symlink: ${dir}`);
  }
  if (!stat.isDirectory()) {
    throw new UnsafePathError(`output directory is not a directory: ${dir}`);
  }
  return resolved;
}

/** Validates a path the bridge is about to READ. Returns the resolved path. */
export function assertReadableFile(p: unknown, allowed?: readonly string[]): string {
  if (typeof p !== 'string' || p.trim() === '') {
    throw new UnsafePathError('input path must be a non-empty string');
  }
  if (p.includes('\0')) {
    throw new UnsafePathError('input path contains a null byte');
  }
  const resolved = path.resolve(p);
  if (allowed) {
    const ext = path.extname(resolved).toLowerCase();
    if (!allowed.includes(ext)) {
      throw new UnsafePathError(`input extension ${ext || '(none)'} is not allowed (allowed: ${allowed.join(', ')})`);
    }
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new UnsafePathError(`input file not found: ${resolved}`);
  }
  if (!stat.isFile()) {
    throw new UnsafePathError(`input path is not a file: ${resolved}`);
  }
  return resolved;
}
