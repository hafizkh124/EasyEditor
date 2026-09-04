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
  type ProjectAsset,
  type ProjectAssetKind,
} from '../../shared/fs/projectTypes.js';
import { CONNECTORS } from '../../shared/agent/connectors.js';

const log = logger.child('fs/projectFolder');

const CHAPTER_EXTS: Record<string, ChapterFormat> = { '.docx': 'docx', '.rtf': 'rtf' };

// ── M9 Phase 3: non-chapter assets (recordings, scans, fonts, templates) ────

const MEDIA_EXTS = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac', '.mp4', '.mkv', '.mov', '.webm']);
const SCAN_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.webp', '.bmp']);
// `.txt` / `.md` carry transcripts and notes — surfaced as mentions and readable
// by `create_chapter`'s `from_source` (M9 Phase 5).
const OTHER_ASSET_EXTS = new Set(['.ttf', '.otf', '.ttc', '.dotx', '.dotm', '.txt', '.md']);
const ALL_ASSET_EXTS = new Set([...MEDIA_EXTS, ...SCAN_EXTS, ...OTHER_ASSET_EXTS]);

function assetKindForExt(ext: string): ProjectAssetKind | null {
  if (MEDIA_EXTS.has(ext)) return 'media';
  if (SCAN_EXTS.has(ext)) return 'scan';
  if (OTHER_ASSET_EXTS.has(ext)) return 'asset';
  return null;
}

/** Resolve an in-project asset path (broader extension set than a chapter), same jail. */
export function resolveAsset(root: string, name: string): string {
  if (typeof name !== 'string' || name.trim() === '' || name.includes('\0')) {
    throw new Error('invalid asset name');
  }
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`asset name must be relative: ${name}`);
  }
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, normalized);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error(`asset path escapes the project folder: ${name}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!ALL_ASSET_EXTS.has(ext)) {
    throw new Error(`unsupported asset type: ${ext || '(none)'}`);
  }
  return resolved;
}

/** Read an in-project text asset (a transcript, notes). Capped so a stray huge file cannot blow up a prompt. */
export function readAssetText(root: string, name: string, maxChars = 200_000): string {
  const abs = resolveAsset(root, name);
  const ext = path.extname(abs).toLowerCase();
  if (ext !== '.txt' && ext !== '.md') throw new Error(`not a readable text asset: ${name}`);
  return fs.readFileSync(abs, 'utf8').slice(0, maxChars);
}

/** Write a text asset into the project (a transcript). Returns its relative path. */
export function writeAssetText(root: string, name: string, text: string): string {
  const abs = resolveAsset(root, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
  return name.replace(/\\/g, '/');
}

/** Every recording / scan / font / template under `sources/` and `media/`. */
export function listAssets(root: string): ProjectAsset[] {
  const rootResolved = path.resolve(root);
  const out: ProjectAsset[] = [];
  for (const sub of ['media', 'sources']) {
    const dir = path.join(rootResolved, sub);
    const walk = (d: string, depth: number): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('~$') || e.name.startsWith('.')) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < 2) walk(full, depth + 1); continue; }
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        const kind = assetKindForExt(ext);
        if (!kind) continue;
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        out.push({
          name: path.relative(rootResolved, full).split(path.sep).join('/'),
          kind, ext, size: stat.size, modifiedAt: stat.mtime.toISOString(),
        });
      }
    };
    walk(dir, 0);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Copy a dropped file into the project folder — `media/` for audio/video,
 * `sources/` for scans, PDFs, fonts and templates. Only the basename of `name`
 * is used (any path is stripped); the destination is re-validated with
 * `resolveAsset` so nothing lands outside the folder. Returns the relative path.
 */
export function importDroppedFile(root: string, name: string, bytes: Uint8Array): ProjectAsset {
  // Spaces → `_` so the file stays a single `@mention` token in the chat box.
  const base = path.basename(String(name)).replace(/[\\/:*?"<>|\0\s]+/g, '_').trim();
  if (!base) throw new Error('a file name is required');
  const ext = path.extname(base).toLowerCase();
  const kind = assetKindForExt(ext);
  if (!kind) throw new Error(`unsupported file type: ${ext || '(none)'}`);
  const sub = kind === 'media' ? 'media' : 'sources';
  const rel = `${sub}/${base}`;
  const dest = resolveAsset(root, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  const stat = fs.statSync(dest);
  log.info('imported dropped file', { rel, kind, size: stat.size });
  return { name: rel, kind, ext, size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

// ── path helpers ───────────────────────────────────────────────────────────

function manifestPath(root: string): string {
  return path.join(root, EASYEDITOR_DIR, MANIFEST_FILE);
}

function backupDir(root: string): string {
  return path.join(root, EASYEDITOR_DIR, BACKUP_DIR);
}

const MAX_SCAN_DEPTH = 4;
const SKIP_DIRS = new Set([EASYEDITOR_DIR, 'node_modules', '.git', '$RECYCLE.BIN']);

/**
 * Resolve a chapter `name` — a path RELATIVE to the project root, using `/`
 * separators (real projects nest chapters in per-section subfolders, e.g.
 * "02-body/draft-3.docx") — and confirm the result stays strictly inside the
 * root. This is the P7 tightening of electron/adapters/paths.ts's guard:
 * blocks `..`, absolute paths, null bytes, and anything that escapes.
 */
export function resolveInProject(root: string, name: string): string {
  if (typeof name !== 'string' || name.trim() === '' || name.includes('\0')) {
    throw new Error('invalid chapter name');
  }
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`chapter name must be relative: ${name}`);
  }
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, normalized);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
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
    const connectors = m.connectors && typeof m.connectors === 'object'
      ? Object.fromEntries(Object.entries(m.connectors).filter(([, v]) => typeof v === 'boolean'))
      : undefined;
    return {
      id: m.id,
      title: typeof m.title === 'string' ? m.title : path.basename(root),
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
      chapterOrder: Array.isArray(m.chapterOrder) ? m.chapterOrder.filter((c) => typeof c === 'string') : [],
      ...(connectors && Object.keys(connectors).length ? { connectors: connectors as Record<string, boolean> } : {}),
      ...(m.ocrConsent === true ? { ocrConsent: true } : {}),
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

/**
 * Every `.docx` / `.rtf` under the project root, recursively (real theses
 * nest a folder per chapter). `name` is the path relative to the root with
 * `/` separators. Depth-capped, and skips `.easyeditor/`, VCS, and system
 * dirs. `~$` Word lock files are ignored.
 */
function listChapterFiles(root: string, order: string[]): ChapterFile[] {
  const orderIndex = new Map(order.map((name, i) => [name, i]));
  const rootResolved = path.resolve(root);
  const chapters: ChapterFile[] = [];

  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('~$')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth >= MAX_SCAN_DEPTH || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const format = CHAPTER_EXTS[path.extname(e.name).toLowerCase()];
      if (!format) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      const rel = path.relative(rootResolved, full).split(path.sep).join('/');
      chapters.push({
        name: rel,
        format,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        order: orderIndex.has(rel) ? orderIndex.get(rel)! : Number.MAX_SAFE_INTEGER,
      });
    }
  };
  walk(rootResolved, 0);

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
  const flat = name.replace(/[\\/]/g, '__');
  const dest = path.join(dir, `${stamp}__${flat}`);
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

// ── M9 Phase 1b: per-project source connectors ─────────────────────────────

/** Read the connector switch map (absent = all on). */
export function readConnectors(root: string): Record<string, boolean> {
  const m = readManifest(root);
  const c = m?.connectors;
  if (!c || typeof c !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(c)) if (typeof v === 'boolean') out[k] = v;
  return out;
}

/**
 * Flip one connector on/off and persist it. A `defaultOff` connector keeps an
 * explicit `true`; all others drop the key when turned on (absent = on).
 */
export function setConnector(root: string, id: string, on: boolean): Record<string, boolean> {
  const manifest = readManifest(root) ?? {
    id: randomUUID(), title: path.basename(root), createdAt: new Date().toISOString(), chapterOrder: [], version: 1 as const,
  };
  const connectors = { ...(manifest.connectors ?? {}) };
  const defaultOff = CONNECTORS.find((c) => c.id === id)?.defaultOff === true;
  if (on) { if (defaultOff) connectors[id] = true; else delete connectors[id]; }
  else { if (defaultOff) delete connectors[id]; else connectors[id] = false; }
  writeManifest(root, { ...manifest, connectors });
  return readConnectors(root);
}

// ── M9 Phase 7: consent to cloud OCR (ADR-0023) ───────────────────────────

/** Has the scholar consented to `ocr_document` for this project? Default false. */
export function readOcrConsent(root: string): boolean {
  return readManifest(root)?.ocrConsent === true;
}

/**
 * Record (or withdraw) the scholar's consent for `ocr_document` to send page
 * images to the cloud OCR service. Consent is per-project and sticky; `false`
 * drops the key so the default (no consent) applies again.
 */
export function setOcrConsent(root: string, granted: boolean): boolean {
  const manifest = readManifest(root) ?? {
    id: randomUUID(), title: path.basename(root), createdAt: new Date().toISOString(), chapterOrder: [], version: 1 as const,
  };
  const next = { ...manifest };
  if (granted) next.ocrConsent = true;
  else delete next.ocrConsent;
  writeManifest(root, next);
  return readOcrConsent(root);
}
