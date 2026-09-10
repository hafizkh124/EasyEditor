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
export const PROJECT_SUBDIRS = ['sources', 'templates', 'export', 'media'] as const;

/**
 * Non-chapter files an agent task can consume — recordings to transcribe,
 * scans to OCR, fonts/templates to install (M9 Phase 3). `sources/` holds
 * scans, PDFs, fonts and templates; `media/` holds audio and video.
 */
export type ProjectAssetKind = 'media' | 'scan' | 'asset';

export interface ProjectAsset {
  /** Path relative to the project root, `/`-separated (e.g. "media/lecture.mp3"). */
  name: string;
  kind: ProjectAssetKind;
  /** Lowercase extension including the dot. */
  ext: string;
  size: number;
  modifiedAt: string;
}

/** The internal folder EasyEditor writes to — excluded from drive sync. */
export const EASYEDITOR_DIR = '.easyeditor';
export const MANIFEST_FILE = 'project.json';
export const BACKUP_DIR = 'backups';
/** Deleted files are moved here, never `fs.rm`'d (plan §3.4). */
export const TRASH_DIR = 'trash';

/** Plan §3.4 — one node of the Project Explorer tree. */
export interface ProjectTreeNode {
  /** Path relative to the project root, `/`-separated. */
  name: string;
  /** Just the last segment, for display. */
  base: string;
  kind: 'dir' | 'file';
  /** Lowercase extension incl. the dot (files only). */
  ext?: string;
  size?: number;
  modifiedAt?: string;
  /** How the explorer opens this file. */
  openAs?: 'editor-docx' | 'editor-text' | 'reader-pdf' | 'external';
  children?: ProjectTreeNode[];
}

export interface ProjectManifest {
  /** Stable id, minted on first open — survives renames of the folder. */
  id: string;
  title: string;
  /** ISO. */
  createdAt: string;
  /** Chapter file names (relative to the folder root), in reading order. */
  chapterOrder: string[];
  /**
   * Per-project source connector switches (M9 Phase 1b). A connector absent
   * from the map is ON; `false` turns it off — the agent then does not see its
   * tools and any playbook step that needs it is skipped.
   */
  connectors?: Record<string, boolean>;
  /**
   * The scholar has consented, for this project, to `ocr_document` sending page
   * images to the cloud OCR service (M9 Phase 7, ADR-0023). Absent / false =
   * not consented; `ocr_document` then returns a consent request and uploads
   * nothing.
   */
  ocrConsent?: boolean;
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
