/**
 * M8 Layer 5 — project-folder types (SPEC-M8 §3 "Layer 5", ADR-0018).
 *
 * Pure: shared/ is imported by the Electron main process and the renderer.
 * No runtime globals — see scripts/check-shared-purity.mjs.
 *
 * A project folder is an ORDINARY folder of real `.docx` / `.rtf` files. It is
 * not a database and not an internal format — its true state can be inspected
 * with File Explorer or Word. EasyEditor keeps only a small manifest under
 * `.easyeditor/` (chapter order + a stable id), and timestamped backups there
 * before it overwrites anything.
 */

/** Formats a chapter file can be, in a project folder. */
export type ChapterFormat = 'docx' | 'rtf';

/** Subfolders scaffolded inside a project folder. */
export const PROJECT_SUBDIRS = ['sources', 'templates', 'export'] as const;

/** The internal folder EasyEditor writes to — excluded from drive sync. */
export const EASYEDITOR_DIR = '.easyeditor';
export const MANIFEST_FILE = 'project.json';
export const BACKUP_DIR = 'backups';

export interface ProjectManifest {
  /** Stable id, minted on first open — survives renames of the folder. */
  id: string;
  title: string;
  /** ISO. */
  createdAt: string;
  /** Chapter file names (relative to the folder root), in reading order. */
  chapterOrder: string[];
  /** Manifest schema version, for future migrations. */
  version: 1;
}

export interface ChapterFile {
  /** File name relative to the project folder root, e.g. "01-intro.docx". */
  name: string;
  format: ChapterFormat;
  /** Bytes. */
  size: number;
  /** ISO mtime — the UI uses this to spot an externally-changed file. */
  modifiedAt: string;
  /** 0-based position from the manifest; files not in the manifest sort last. */
  order: number;
}

export interface ProjectFolder {
  /** Absolute path to the folder root. */
  path: string;
  manifest: ProjectManifest;
  chapters: ChapterFile[];
}

/** Result of writing a chapter — the backup that was taken first, if any. */
export interface ChapterWriteResult {
  name: string;
  /** Absolute path of the `.easyeditor/backups/` copy, or null if the file was new. */
  backupPath: string | null;
  bytes: number;
}
