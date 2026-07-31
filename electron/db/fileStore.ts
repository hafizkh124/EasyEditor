// Local file storage for the desktop library (SPEC-M5 FR-4.6, FR-1.8).
//
// The cloud keeps uploads in the `library-files` Storage bucket; on desktop
// they live under `userData/files/`. `library_items.storage_path` holds a
// path relative to that root in both worlds, so the only difference is who
// resolves it.
//
// Deleting an item must delete its bytes too: leaving the original PDF on
// disk after the user removed the book from their library is exactly the
// kind of quiet retention the local mode exists to avoid.

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

function filesRoot(): string {
  return path.join(app.getPath('userData'), 'files');
}

/**
 * Resolves a storage_path under the files root, refusing anything that would
 * escape it. storage_path reaches here from the database, so a traversal
 * sequence must not be able to read or delete outside the library.
 */
function resolveWithinRoot(storagePath: string): string {
  const root = filesRoot();
  const resolved = path.resolve(root, storagePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`storage_path escapes the files root: ${storagePath}`);
  }
  return resolved;
}

/** Writes bytes and returns the storage_path to record on the library item. */
export function writeLibraryFile(relativePath: string, bytes: Buffer): string {
  const dest = resolveWithinRoot(relativePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  return relativePath;
}

/** Reads a stored file. Returns null when it is missing. */
export function readLibraryFile(storagePath: string): Buffer | null {
  try {
    const src = resolveWithinRoot(storagePath);
    if (!fs.existsSync(src)) return null;
    return fs.readFileSync(src);
  } catch {
    return null;
  }
}

/** Deletes a stored file. Missing files are not an error — the goal is absence. */
export function deleteLibraryFile(storagePath: string): void {
  try {
    const target = resolveWithinRoot(storagePath);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch (err) {
    console.warn('[fileStore] delete failed:', err);
  }
}
