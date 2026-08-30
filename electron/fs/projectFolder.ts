import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../lib/logger.js';
import {
  PROJECT_SUBDIRS,
  EASYEDITOR_DIR,
  MANIFEST_FILE,
  BACKUP_DIR,
  type ProjectManifest,
  type ProjectFolder,
  type ChapterFile,
  type ChapterFormat,
} from '../../shared/fs/projectTypes.js';

const log = logger.child('fs/projectFolder');

const CHAPTER_EXTS: Record<string, ChapterFormat> = { '.docx': 'docx', '.rtf': 'rtf' };

// ── path helpers ───────────────────────────────────────────────────────────

function manifestPath(root: string): string {
  return path.join(root, EASYEDITOR_DIR, MANIFEST_FILE);
}

function backupDir(root: string): string {
  return path.join(root, EASYEDITOR_DIR, BACKUP_DIR);
}

/**
 * Resolve `name` (which must be a bare file name, no separators) inside the
 * project root, and confirm it stays inside. This is the P7 tightening of
 * electron/adapters/paths.ts's guard: a chapter write can only touch a file
 * directly in the open project folder.
 */
export function resolveInProject(root: string, name: string): string {
  if (typeof name !== 'string' || name.trim() === '' || name.includes('\0')) {
    throw new Error('invalid chapter name');
  }
  if (name !== path.basename(name) || name === '.' || name === '..') {
    throw new Error(`chapter name must be a bare file name: ${name}`);
  }
  const resolved = path.resolve(root, name);
  const rootResolved = path.resolve(root);
  if (resolved !== path.join(rootResolved, name)) {
    throw new Error(`chapter path escapes the project folder: ${name}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!(ext in CHAPTER_EXTS)) {
    throw new Error(`unsupported chapter format: ${ext || '(none)'}`);
  }
  return resolved;
}

// ── manifest ───────────────────────────────────────────────────────────────

function readManifest(root: string): ProjectManifest | null {
  try {
    const raw = fs.readFileSync(manifestPath(root), 'utf8');
    const m = JSON.parse(raw) as Partial<ProjectManifest>;
    if (!m.id || typeof m.id !== 'string') return null;
    return {
      id: m.id,
      title: typeof m.title === 'string' ? m.title : path.basename(root),
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
      chapterOrder: Array.isArray(m.chapterOrder) ? m.chapterOrder.filter((c) => typeof c === 'string') : [],
      version: 1,
    };
  } catch {
    return null;
  }
}

function writeManifest(root: string, m: ProjectManifest): void {
  fs.mkdirSync(path.join(root, EASYEDITOR_DIR), { recursive: true });
  fs.writeFileSync(manifestPath(root), JSON.stringify(m, null, 2), 'utf8');
}

// ── chapter listing ────────────────────────────────────────────────────────

function listChapterFiles(root: string, order: string[]): ChapterFile[] {
  const orderIndex = new Map(order.map((name, i) => [name, i]));
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const chapters: ChapterFile[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    const format = CHAPTER_EXTS[ext];
    if (!format) continue;
    if (e.name.startsWith('~$')) continue; // Word lock file
    const stat = fs.statSync(path.join(root, e.name));
    chapters.push({
      name: e.name,
      format,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      order: orderIndex.has(e.name) ? orderIndex.get(e.name)! : Number.MAX_SAFE_INTEGER,
    });
  }
  chapters.sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
  chapters.forEach((c, i) => { c.order = i; });
  return chapters;
}

// ── public API ─────────────────────────────────────────────────────────────

/** Scaffold a fresh project folder at `root` (which must be empty or new). */
export function createProjectFolder(root: string, title: string): ProjectFolder {
  fs.mkdirSync(root, { recursive: true });
  const existing = fs.readdirSync(root).filter((n) => n !== EASYEDITOR_DIR);
  if (existing.length > 0) {
    throw new Error('folder is not empty — open it instead of creating a project here');
  }
  for (const sub of PROJECT_SUBDIRS) fs.mkdirSync(path.join(root, sub), { recursive: true });
  fs.mkdirSync(backupDir(root), { recursive: true });

  const manifest: ProjectManifest = {
    id: randomUUID(),
    title: title.trim() || path.basename(root),
    createdAt: new Date().toISOString(),
    chapterOrder: [],
    version: 1,
  };
  writeManifest(root, manifest);
  log.info('created project folder', { root, id: manifest.id });
  return { path: path.resolve(root), manifest, chapters: [] };
}

/**
 * Open an existing folder as a project. If it has no `.easyeditor/` manifest
 * yet (a plain folder of `.docx` files the user points at), one is created —
 * the folder's files are the truth, the manifest just records their order.
 */
export function openProjectFolder(root: string): ProjectFolder {
  const resolved = path.resolve(root);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error(`not a folder: ${resolved}`);

  let manifest = readManifest(resolved);
  if (!manifest) {
    manifest = {
      id: randomUUID(),
      title: path.basename(resolved),
      createdAt: new Date().toISOString(),
      chapterOrder: [],
      version: 1,
    };
  }

  const chapters = listChapterFiles(resolved, manifest.chapterOrder);
  // Keep the manifest's order list in step with what's actually on disk.
  manifest.chapterOrder = chapters.map((c) => c.name);
  fs.mkdirSync(backupDir(resolved), { recursive: true });
  writeManifest(resolved, manifest);

  return { path: resolved, manifest, chapters };
}

/** Re-read the chapter list (after an external change or a write). */
export function refreshChapters(root: string): ChapterFile[] {
  const manifest = readManifest(root);
  return listChapterFiles(path.resolve(root), manifest?.chapterOrder ?? []);
}

/**
 * Copy `<name>` into `.easyeditor/backups/` with a timestamp prefix before it
 * is overwritten. Returns the backup path, or null when the file did not exist
 * yet (a new chapter).
 */
export function backupChapter(root: string, name: string): string | null {
  const src = resolveInProject(root, name);
  if (!fs.existsSync(src)) return null;
  const dir = backupDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `${stamp}__${name}`);
  fs.copyFileSync(src, dest);
  return dest;
}

/**
 * Record a chapter file that was just written into the folder (by the Word
 * adapter) in the manifest's order list, so it keeps a stable position. Does
 * not move or rewrite the file — the adapter already put it there.
 */
export function registerChapter(root: string, name: string): { bytes: number } {
  const abs = resolveInProject(root, name);
  const manifest = readManifest(root) ?? {
    id: randomUUID(), title: path.basename(root), createdAt: new Date().toISOString(), chapterOrder: [], version: 1 as const,
  };
  if (!manifest.chapterOrder.includes(name)) {
    manifest.chapterOrder.push(name);
    writeManifest(root, manifest);
  }
  return { bytes: fs.statSync(abs).size };
}

/** The absolute path a chapter should be written to (for the Word adapter). */
export function chapterPath(root: string, name: string): string {
  return resolveInProject(root, name);
}
