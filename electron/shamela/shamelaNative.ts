import { app } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from "../lib/logger.js";

const log = logger.child("shamelaNative");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShamelaStatus {
  installed: boolean;
  path: string | null;
  version?: string;
  jrePath?: string | null;
  lucenePath?: string | null;
  masterDbPath?: string | null;
  /** Path to Shamela's morphological roots DB (database/service/S2.db). */
  s2DbPath?: string | null;
  bookCount?: number;
  reason?: string;
}

export interface ShamelaSearchResult {
  bookId: string;
  bookTitle: string;
  pageNumber: number;
  snippet: string;
  score: number;
}

export interface ShamelaPageContent {
  bookId: string;
  pageNumber: number;
  text: string;
  footnotes?: string;
}

export interface ShamelaDiagnostics {
  jreFound: boolean;
  jreVersion: string | null;
  luceneJarsFound: boolean;
  luceneVersion: string | null;
  masterDbFound: boolean;
  storeIndexFound: boolean;
  bookCount: number;
  errors: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'shamela_config.json');

/**
 * ADR-0007: The program folder (C:\Program Files\shamela) and the library
 * folder (D:\shamela4) are different. Discovery must look for a directory
 * containing `database/master.db`, not for the uninstall entry.
 */
const CANDIDATE_LIBRARY_PATHS = [
  'D:\\shamela4',
  'E:\\shamela4',
  'C:\\shamela4',
  'D:\\shamela',
  'E:\\shamela',
  'C:\\Program Files\\shamela',
  'C:\\Program Files (x86)\\shamela',
];

// ─── Config persistence ─────────────────────────────────────────────────────

export function getSavedShamelaPath(): string | null {
  try {
    const file = CONFIG_PATH();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data.shamelaPath || null;
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

export function saveShamelaPath(customPath: string): void {
  const file = CONFIG_PATH();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(file, JSON.stringify({ shamelaPath: customPath }, null, 2), 'utf8');
}

// ─── Discovery (ADR-0007 §Decision) ─────────────────────────────────────────

function findJre(base: string): string | null {
  const jre64 = path.join(base, 'app', 'win', '64', 'jre', '2', 'bin', 'java.exe');
  if (fs.existsSync(jre64)) return jre64;
  const jre32 = path.join(base, 'app', 'win', '32', 'jre', '2', 'bin', 'java.exe');
  if (fs.existsSync(jre32)) return jre32;
  return null;
}

function findLuceneDir(base: string): string | null {
  const luceneDir = path.join(base, 'app', 'lucene', '2');
  if (fs.existsSync(luceneDir)) return luceneDir;
  return null;
}

function findMasterDb(base: string): string | null {
  const masterDb = path.join(base, 'database', 'master.db');
  if (fs.existsSync(masterDb)) return masterDb;
  return null;
}

function findS2Db(base: string): string | null {
  const s2 = path.join(base, 'database', 'service', 'S2.db');
  if (fs.existsSync(s2)) return s2;
  return null;
}

function findStoreIndex(base: string): boolean {
  const storePage = path.join(base, 'database', 'store', 'page');
  return fs.existsSync(storePage);
}

export async function detectShamelaInstallation(): Promise<ShamelaStatus> {
  const custom = getSavedShamelaPath();
  const candidates = custom ? [custom, ...CANDIDATE_LIBRARY_PATHS] : CANDIDATE_LIBRARY_PATHS;

  for (const base of candidates) {
    if (!base || !fs.existsSync(base)) continue;

    const masterDb = findMasterDb(base);
    const jrePath = findJre(base);
    const lucenePath = findLuceneDir(base);

    // ADR-0007: discovery key = directory containing database/master.db
    if (masterDb) {
      return {
        installed: true,
        path: base,
        version: '4.0',
        jrePath,
        lucenePath,
        masterDbPath: masterDb,
        s2DbPath: findS2Db(base),
        bookCount: 0, // filled from catalogue:stats
      };
    }
  }

  return {
    installed: false,
    path: custom || null,
    reason: 'مکتبہ شاملہ ۴ نہیں ملی۔ براہ کرم شاملہ ۴ انسٹال کریں یا ترتیبات میں اس کی ڈائرکٹری بتائیں۔',
  };
}

// ─── Diagnostics (FR-5.9 seven-step checklist) ─────────────────────────────

export async function diagnoseShamelaInstallation(): Promise<ShamelaDiagnostics> {
  const status = await detectShamelaInstallation();
  const errors: string[] = [];

  if (!status.installed || !status.path) {
    return {
      jreFound: false,
      jreVersion: null,
      luceneJarsFound: false,
      luceneVersion: null,
      masterDbFound: false,
      storeIndexFound: false,
      bookCount: 0,
      errors: [status.reason || 'شاملہ انسٹالیشن نہیں ملی۔'],
    };
  }

  const base = status.path;
  const jrePath = findJre(base);
  const luceneDir = findLuceneDir(base);
  const masterDb = findMasterDb(base);
  const storeFound = findStoreIndex(base);

  let jreVersion: string | null = null;
  if (jrePath) {
    try {
      jreVersion = await getJavaVersion(jrePath);
    } catch {
      errors.push('Java ورژن معلوم نہیں ہو سکا۔');
    }
  } else {
    errors.push('Java Runtime (JRE) نہیں ملا۔ شاملہ کی مرمت کریں۔');
  }

  let luceneVersion: string | null = null;
  if (luceneDir) {
    try {
      const jars = fs.readdirSync(luceneDir).filter(f => f.startsWith('lucene-core-') && f.endsWith('.jar'));
      if (jars.length > 0) {
        const match = jars[0].match(/lucene-core-(\d+\.\d+\.\d+)\.jar/);
        luceneVersion = match ? match[1] : 'unknown';
      }
    } catch {
      errors.push('لوسین جارز پڑھنے میں خرابی۔');
    }
  } else {
    errors.push('لوسین لائبریری ڈائرکٹری نہیں ملی۔');
  }

  if (!masterDb) {
    errors.push('database/master.db نہیں ملا۔');
  }

  if (!storeFound) {
    errors.push('database/store/page/ انڈیکس نہیں ملا — متن کی تلاش ممکن نہیں۔');
  }

  return {
    jreFound: !!jrePath,
    jreVersion,
    luceneJarsFound: !!luceneDir,
    luceneVersion,
    masterDbFound: !!masterDb,
    storeIndexFound: storeFound,
    bookCount: 0, // filled by caller from master.db if needed
    errors,
  };
}

// ─── Java helper spawn (ADR-0007 §Decision — textHelper) ───────────────────

function getHelperJarPath(): string {
  const appPath = app.getAppPath();

  const candidates = [
    // Packaged: electron-builder's extraResources puts it here.
    path.join(process.resourcesPath || '', 'bin', 'shamela-helper.jar'),
    // Dev: the build script writes both of these. Note that __dirname is
    // dist-electron/ once main.ts is bundled, not electron/shamela/, so the
    // paths have to be anchored to the app root instead.
    path.join(appPath, 'resources', 'bin', 'shamela-helper.jar'),
    path.join(appPath, 'electron', 'shamela', 'java', 'shamela-helper.jar'),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  // R15: say where it looked, so a packaging mistake is diagnosable from the
  // message alone rather than needing a debugger.
  throw new Error(
    'shamela-helper.jar نہیں ملا۔ `node scripts/build-shamela-helper.mjs` چلائیں۔ ' +
      `تلاش کیے گئے راستے: ${candidates.filter(Boolean).join(' | ')}`,
  );
}

function buildClasspath(luceneDir: string, helperJar: string): string {
  const jars: string[] = [helperJar];
  try {
    const files = fs.readdirSync(luceneDir).filter(f => f.endsWith('.jar'));
    for (const f of files) {
      jars.push(path.join(luceneDir, f));
    }
  } catch {
    // If lucene dir can't be read, just use helper jar alone
  }
  return jars.join(';'); // Windows path separator
}

async function getJavaVersion(jrePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(jrePath, ['-version'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      if (code === 0 || stderr.length > 0) {
        const match = stderr.match(/version "([^"]+)"/);
        resolve(match ? match[1] : stderr.trim());
      } else {
        reject(new Error(`java -version exited with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Spawns the Java helper as a subprocess and sends a JSON command.
 * Returns the parsed JSON response from stdout.
 *
 * Protocol: one-shot. Each call spawns, sends command, reads response, exits.
 * ADR-0007: windowsHide:true, Shamela's own JRE, classpath includes Shamela's Lucene jars.
 */
export async function invokeJavaHelper(
  jrePath: string,
  luceneDir: string | null,
  command: string,
  args: string[],
): Promise<unknown> {
  const helperJar = getHelperJarPath();
  const classpath = luceneDir
    ? buildClasspath(luceneDir, helperJar)
    : helperJar;

  return new Promise((resolve, reject) => {
    const proc = spawn(jrePath, ['-cp', classpath, 'com.alulama.easyeditor.shamela.ShamelaHelper', command, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Java helper exited with code ${code}: ${stderr || 'no output'}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.status === 'error') {
          reject(new Error(parsed.message || 'Java helper returned error'));
        } else {
          resolve(parsed);
        }
      } catch {
        reject(new Error(`Invalid JSON from Java helper: ${stdout.substring(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Java helper: ${err.message}`));
    });
  });
}

// ─── High-level API ─────────────────────────────────────────────────────────

export async function searchShamelaNative(queryText: string, limit = 20): Promise<ShamelaSearchResult[]> {
  const status = await detectShamelaInstallation();
  if (!status.installed || !status.path) {
    throw new Error('مکتبہ شاملہ ۴ انسٹال نہیں ہے یا اس مشین پر نہیں ملی۔');
  }

  if (!status.jrePath) {
    throw new Error('شاملہ کی Java Runtime (JRE) نہیں ملی۔ شاملہ کی مرمت کریں۔');
  }

  const storeIndex = path.join(status.path, 'database', 'store', 'page');
  if (!fs.existsSync(storeIndex)) {
    throw new Error('database/store/page/ انڈیکس نہیں ملا — متن کی تلاش ممکن نہیں۔');
  }

  try {
    const result = await invokeJavaHelper(
      status.jrePath,
      status.lucenePath || null,
      'search',
      [storeIndex, queryText, String(limit)],
    );
    const data = result as { results?: ShamelaSearchResult[] };
    return data.results || [];
  } catch (err) {
    log.error("search error", { err });
    throw err;
  }
}

export interface ShamelaBookPage {
  page: string;
  footnotes?: string;
  text: string;
}

/**
 * Reads every page of one book in a single JVM spawn.
 *
 * SPEC-M5.9 risk N4: `readShamelaPage` starts a JVM per call, so importing a
 * 500-page book through it would start 500 of them. This uses the helper's
 * `readBook` command, which emits a header line then one JSON object per page.
 *
 * `onPage` is called as each line arrives, so a book is never held twice in
 * memory, and returning `false` from it stops the read (used to honour a
 * cancelled import without waiting for the remaining pages).
 */
export async function readShamelaBook(
  bookId: string,
  onPage: (page: ShamelaBookPage) => boolean | void,
): Promise<{ pageCount: number }> {
  const status = await detectShamelaInstallation();
  if (!status.installed || !status.path) {
    throw new Error('مکتبہ شاملہ ۴ انسٹال نہیں ہے۔');
  }
  if (!status.jrePath) {
    throw new Error('شاملہ کی Java Runtime (JRE) نہیں ملی۔ شاملہ کی مرمت کریں۔');
  }

  const storeIndex = path.join(status.path, 'database', 'store', 'page');
  if (!fs.existsSync(storeIndex)) {
    throw new Error('database/store/page/ انڈیکس نہیں ملا — کتاب پڑھی نہیں جا سکتی۔');
  }

  const helperJar = getHelperJarPath();
  const classpath = status.lucenePath ? buildClasspath(status.lucenePath, helperJar) : helperJar;

  return new Promise((resolve, reject) => {
    const proc = spawn(
      status.jrePath!,
      ['-cp', classpath, 'com.alulama.easyeditor.shamela.ShamelaHelper', 'readBook', storeIndex, bookId],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60_000 },
    );

    let buffer = '';
    let stderr = '';
    let pageCount = 0;
    let headerSeen = false;
    let stopped = false;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return; // ignore anything that is not one of our JSON lines
      }

      if (parsed.status === 'error') {
        stopped = true;
        proc.kill();
        reject(new Error(String(parsed.message || 'Java helper returned error')));
        return;
      }

      if (!headerSeen && parsed.status === 'success') {
        headerSeen = true;
        pageCount = typeof parsed.pageCount === 'number' ? parsed.pageCount : 0;
        return;
      }

      const keepGoing = onPage({
        page: String(parsed.page ?? ''),
        footnotes: String(parsed.footnotes ?? ''),
        text: String(parsed.text ?? ''),
      });

      if (keepGoing === false) {
        stopped = true;
        proc.kill();
        resolve({ pageCount });
      }
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (stopped) return;
        handleLine(line);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (stopped) return;
      if (buffer.trim()) handleLine(buffer);
      if (stopped) return;

      if (code !== 0 && !headerSeen) {
        reject(new Error(`Java helper exited with code ${code}: ${stderr || 'no output'}`));
        return;
      }
      resolve({ pageCount });
    });

    proc.on('error', (err) => {
      if (!stopped) reject(new Error(`Failed to spawn Java helper: ${err.message}`));
    });
  });
}

export async function readShamelaPage(bookId: string, pageNumber: number): Promise<ShamelaPageContent> {
  const status = await detectShamelaInstallation();
  if (!status.installed || !status.path) {
    throw new Error('مکتبہ شاملہ ۴ انسٹال نہیں ہے۔');
  }

  if (!status.jrePath) {
    throw new Error('شاملہ کی Java Runtime (JRE) نہیں ملی۔');
  }

  const storeIndex = path.join(status.path, 'database', 'store', 'page');

  try {
    const result = await invokeJavaHelper(
      status.jrePath,
      status.lucenePath || null,
      'read',
      [storeIndex, bookId, String(pageNumber)],
    );
    return result as ShamelaPageContent;
  } catch (err) {
    log.error("read error", { err });
    throw err;
  }
}

export interface ShamelaTocTitle {
  titleId: string;
  text: string;
}

export interface ShamelaTocEntry {
  titleId: string;
  text: string;
  page: number;
  parent: string;
  /** depth in the title tree; 0 = top level */
  depth: number;
}

/**
 * Full table of contents for one book: Lucene heading text joined with the
 * book's SQLite `title(id, page, parent)` table, which carries the page number
 * and the parent link that defines the heading tree.
 *
 * Returns entries ordered by page (reading order). `parent` is the parent's
 * titleId (empty string for top-level headings).
 */
export async function readShamelaTocJoined(bookId: string): Promise<ShamelaTocEntry[]> {
  const status = await detectShamelaInstallation();
  if (!status.installed || !status.path) {
    throw new Error('مکتبہ شاملہ ۴ انسٹال نہیں ہے۔');
  }

  const titles = await readShamelaToc(bookId);

  const bookDbPath = getShamelaBookDbPath(status.path, bookId);
  if (!fs.existsSync(bookDbPath)) {
    throw new Error(`کتاب کی ڈیٹابیس نہیں ملی: ${bookDbPath}`);
  }

  // Better-sqlite3 is imported lazily so this module can be loaded in any
  // context; the desktop main process always has it available.
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(bookDbPath, { readonly: true });

  try {
    const rows = db
      .prepare('SELECT id, page, parent FROM title ORDER BY page')
      .all() as Array<{ id: number; page: number; parent: number }>;

    const titleById = new Map<string, string>();
    for (const t of titles) titleById.set(t.titleId, t.text);

    const entries: ShamelaTocEntry[] = [];
    for (const row of rows) {
      const id = String(row.id);
      const text = titleById.get(id);
      if (text === undefined) continue;

      // Depth = how far up we must climb before the parent is a root (0).
      let depth = 0;
      let pid = row.parent;
      while (pid > 0) {
        depth++;
        const parentRow = rows.find(r => r.id === pid);
        if (!parentRow || parentRow.id === row.id) break;
        pid = parentRow.parent;
      }

      entries.push({
        titleId: id,
        text,
        page: row.page,
        parent: row.parent > 0 ? String(row.parent) : '',
        depth,
      });
    }

    return entries;
  } finally {
    db.close();
  }
}

/**
 * Reads one book's table of contents from the global `store/title` Lucene index.
 *
 * Returns only the Lucene side ({titleId, text}). Page numbers and the heading
 * tree live in the book's own SQLite `title(id, page, parent)` table; the caller
 * joins them (see joinShamelaToc) to build the navigable TOC.
 */
export async function readShamelaToc(bookId: string): Promise<ShamelaTocTitle[]> {
  const status = await detectShamelaInstallation();
  if (!status.installed || !status.path) {
    throw new Error('مکتبہ شاملہ ۴ انسٹال نہیں ہے۔');
  }
  if (!status.jrePath) {
    throw new Error('شاملہ کی Java Runtime (JRE) نہیں ملی۔');
  }

  const titleIndex = path.join(status.path, 'database', 'store', 'title');
  if (!fs.existsSync(titleIndex)) {
    throw new Error('database/store/title/ انڈیکس نہیں ملا — فہرستِ ابواب پڑھی نہیں جا سکتی۔');
  }

  return new Promise((resolve, reject) => {
    const helperJar = getHelperJarPath();
    const classpath = status.lucenePath ? buildClasspath(status.lucenePath, helperJar) : helperJar;

    const proc = spawn(
      status.jrePath!,
      ['-cp', classpath, 'com.alulama.easyeditor.shamela.ShamelaHelper', 'readToc', titleIndex, bookId],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
    );

    let buffer = '';
    let stderr = '';
    const titles: ShamelaTocTitle[] = [];
    let headerSeen = false;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }

      if (parsed.status === 'error') {
        proc.kill();
        reject(new Error(String(parsed.message || 'Java helper returned error')));
        return;
      }

      if (!headerSeen && parsed.status === 'success') {
        headerSeen = true;
        return;
      }

      titles.push({
        titleId: String(parsed.titleId ?? ''),
        text: String(parsed.text ?? ''),
      });
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });

    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (buffer.trim()) handleLine(buffer);
      if (code !== 0 && !headerSeen) {
        reject(new Error(`Java helper exited with code ${code}: ${stderr || 'no output'}`));
        return;
      }
      resolve(titles);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Java helper: ${err.message}`));
    });
  });
}

/**
 * The book DB path in Shamela 4 is database/book/<bookId % 1000>/<bookId>.db
 * (three-digit zero-padded group folder, e.g. book 1001 -> 001/1001.db).
 */
export function getShamelaBookDbPath(libraryPath: string, bookId: string): string {
  const numeric = Number.parseInt(bookId, 10);
  const group = Number.isNaN(numeric) ? '000' : String(numeric % 1000).padStart(3, '0');
  return path.join(libraryPath, 'database', 'book', group, `${bookId}.db`);
}

/**
 * The number of pages in one book, read from the book's own `page` table.
 * Used for next/previous navigation bounds (page 1 .. pageCount).
 */
export async function getShamelaPageCount(bookId: string): Promise<number> {
  const status = await detectShamelaInstallation();
  if (!status.installed || !status.path) {
    throw new Error('مکتبہ شاملہ ۴ انسٹال نہیں ہے۔');
  }

  const bookDbPath = getShamelaBookDbPath(status.path, bookId);
  if (!fs.existsSync(bookDbPath)) {
    throw new Error(`کتاب کی ڈیٹابیس نہیں ملی: ${bookDbPath}`);
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(bookDbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT COUNT(*) as c FROM page').get() as { c: number } | undefined;
    return row?.c ?? 0;
  } finally {
    db.close();
  }
}
