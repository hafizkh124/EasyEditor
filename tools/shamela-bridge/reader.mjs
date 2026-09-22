// Shamela 4 Reader — web bridge module (UX-v1 P7 follow-up).
//
// Ports the *native* reading path from electron/shamela/shamelaNative.ts
// (ADR-0007) into this standalone Node script, rather than routing through
// shamela-mcp's own `shamela_get_page`/`shamela_get_toc` tools. That was the
// original plan, but live testing against the real installation found
// shamela-mcp's own SQLite reader (`PageStore`, sql.js/WASM) returns empty
// results for books whose per-book .db is large/real (verified: book 71,
// 33,219 real rows via better-sqlite3, `pages.pageCount()` via shamela-mcp
// returns 0) — even though the exact same page's TEXT is retrievable via a
// direct Lucene lookup with the exact same numeric id. So: this module reads
// SQLite structure directly with better-sqlite3 (same as Electron) and reads
// page/TOC text by spawning the SAME shamela-helper.jar already vendored at
// electron/shamela/java/shamela-helper.jar (same ADR-0007 Java bridge,
// running in this Node process instead of Electron's main process) — no
// dependency on shamela-mcp's PageStore for any of this.
//
// Confirmed live: Electron's `pageNumber` and this module's page number are
// the same value — the book's own SQLite `page.id` row — matching what
// `useReaderState.ts`/`ShamelaHelper.java`'s own comment already documented.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATE_LIBRARY_PATHS = [
  process.env.SHAMELA_LIBRARY_PATH,
  'D:\\shamela4', 'E:\\shamela4', 'C:\\shamela4',
  'D:\\shamela', 'E:\\shamela',
  'C:\\Program Files\\shamela', 'C:\\Program Files (x86)\\shamela',
].filter(Boolean);

function findJre(base) {
  const jre64 = path.join(base, 'app', 'win', '64', 'jre', '2', 'bin', 'java.exe');
  if (fs.existsSync(jre64)) return jre64;
  const jre32 = path.join(base, 'app', 'win', '32', 'jre', '2', 'bin', 'java.exe');
  if (fs.existsSync(jre32)) return jre32;
  return null;
}

function findLuceneDir(base) {
  const dir = path.join(base, 'app', 'lucene', '2');
  return fs.existsSync(dir) ? dir : null;
}

let cachedInstall; // undefined = not yet probed, null = probed and not found
function detectShamelaPath() {
  if (cachedInstall !== undefined) return cachedInstall;
  for (const base of CANDIDATE_LIBRARY_PATHS) {
    if (!base || !fs.existsSync(base)) continue;
    const masterDb = path.join(base, 'database', 'master.db');
    if (!fs.existsSync(masterDb)) continue;
    const jrePath = findJre(base);
    if (!jrePath) continue;
    cachedInstall = { path: base, jrePath, lucenePath: findLuceneDir(base) };
    return cachedInstall;
  }
  cachedInstall = null;
  return null;
}

/**
 * Two layouts have to work: the packaged bridge, where the jar sits in `lib/`
 * beside this file (scripts/package-shamela-bridge.mjs), and a dev checkout,
 * where it lives at its source of truth in electron/shamela/java/. Probe both
 * rather than assuming the repo is reachable — outside a checkout it is not.
 */
const HELPER_JAR_CANDIDATES = [
  path.join(__dirname, 'lib', 'shamela-helper.jar'),
  path.join(__dirname, '..', '..', 'electron', 'shamela', 'java', 'shamela-helper.jar'),
];

function getHelperJarPath() {
  for (const jar of HELPER_JAR_CANDIDATES) {
    if (fs.existsSync(jar)) return jar;
  }
  throw new Error(`shamela-helper.jar نہیں ملا: ${HELPER_JAR_CANDIDATES.join(', ')}`);
}

function buildClasspath(luceneDir, helperJar) {
  const jars = [helperJar];
  if (luceneDir) {
    try {
      for (const f of fs.readdirSync(luceneDir).filter((f) => f.endsWith('.jar'))) {
        jars.push(path.join(luceneDir, f));
      }
    } catch { /* helper jar alone */ }
  }
  return jars.join(';'); // Windows classpath separator
}

/** One-shot helper spawn: single JSON object on stdout. */
function invokeJavaHelper(install, command, args) {
  const helperJar = getHelperJarPath();
  const classpath = buildClasspath(install.lucenePath, helperJar);
  return new Promise((resolve, reject) => {
    const proc = spawn(
      install.jrePath,
      ['-cp', classpath, 'com.alulama.easyeditor.shamela.ShamelaHelper', command, ...args],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Java helper exited with code ${code}: ${stderr || 'no output'}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.status === 'error') reject(new Error(parsed.message || 'Java helper returned error'));
        else resolve(parsed);
      } catch {
        reject(new Error(`Invalid JSON from Java helper: ${stdout.slice(0, 200)}`));
      }
    });
    proc.on('error', (err) => reject(new Error(`Failed to spawn Java helper: ${err.message}`)));
  });
}

/** Streaming helper spawn (readToc): NDJSON — header line, then one object per title. */
function invokeJavaHelperStream(install, command, args) {
  const helperJar = getHelperJarPath();
  const classpath = buildClasspath(install.lucenePath, helperJar);
  return new Promise((resolve, reject) => {
    const proc = spawn(
      install.jrePath,
      ['-cp', classpath, 'com.alulama.easyeditor.shamela.ShamelaHelper', command, ...args],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
    );
    let buffer = '';
    let stderr = '';
    const items = [];
    let headerSeen = false;

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try { parsed = JSON.parse(trimmed); } catch { return; }
      if (parsed.status === 'error') {
        proc.kill();
        reject(new Error(String(parsed.message || 'Java helper returned error')));
        return;
      }
      if (!headerSeen && parsed.status === 'success') {
        headerSeen = true;
        return;
      }
      items.push(parsed);
    };

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => {
      if (buffer.trim()) handleLine(buffer);
      if (code !== 0 && !headerSeen) {
        reject(new Error(`Java helper exited with code ${code}: ${stderr || 'no output'}`));
        return;
      }
      resolve(items);
    });
    proc.on('error', (err) => reject(new Error(`Failed to spawn Java helper: ${err.message}`)));
  });
}

function getBookDbPath(libraryPath, bookId) {
  const numeric = Number.parseInt(bookId, 10);
  const group = Number.isNaN(numeric) ? '000' : String(numeric % 1000).padStart(3, '0');
  return path.join(libraryPath, 'database', 'book', group, `${bookId}.db`);
}

/**
 * `better-sqlite3` is a native module resolved from this repo's node_modules
 * — absent from the standalone packaged bridge (scripts/package-shamela-bridge.mjs
 * ships no node_modules at all). `node:sqlite`'s DatabaseSync exposes the same
 * .prepare().get()/.all() / .close() surface this module actually uses (the
 * only API surface below), and is unflagged from Node 22.13, which
 * start-bridge.bat/.sh already require (see the version check there). Prefer
 * it; fall back to better-sqlite3 for a dev checkout on an older Node.
 */
async function openBookDb(libraryPath, bookId) {
  const dbPath = getBookDbPath(libraryPath, bookId);
  if (!fs.existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    const Database = (await import('better-sqlite3')).default;
    return new Database(dbPath, { readonly: true });
  }
}

export function isReaderAvailable() {
  return detectShamelaPath() !== null;
}

export async function readPage(bookId, pageNumber) {
  const install = detectShamelaPath();
  if (!install) throw new Error('مکتبہ شاملہ ۴ نہیں ملی۔');
  const storeIndex = path.join(install.path, 'database', 'store', 'page');
  if (!fs.existsSync(storeIndex)) throw new Error('database/store/page/ انڈیکس نہیں ملا۔');
  const result = await invokeJavaHelper(install, 'read', [storeIndex, String(bookId), String(pageNumber)]);
  return {
    bookId: String(bookId),
    pageNumber: Number(pageNumber),
    text: result.text || '',
    footnotes: result.footnotes || '',
  };
}

/**
 * One JVM spawn for the whole book (SPEC-M5.9 risk N4, ADR-0007) — used by
 * "Import to Workspace" so a large book doesn't spawn one JVM per page.
 * Pages come back sorted by numeric page id: Lucene's TermRangeQuery order
 * isn't a reading-order guarantee even though it looks that way in practice.
 */
export async function readBook(bookId) {
  const install = detectShamelaPath();
  if (!install) throw new Error('مکتبہ شاملہ ۴ نہیں ملی۔');
  const storeIndex = path.join(install.path, 'database', 'store', 'page');
  if (!fs.existsSync(storeIndex)) throw new Error('database/store/page/ انڈیکس نہیں ملا۔');

  const helperJar = getHelperJarPath();
  const classpath = buildClasspath(install.lucenePath, helperJar);

  return new Promise((resolve, reject) => {
    const proc = spawn(
      install.jrePath,
      ['-cp', classpath, 'com.alulama.easyeditor.shamela.ShamelaHelper', 'readBook', storeIndex, String(bookId)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60_000 },
    );
    let buffer = '';
    let stderr = '';
    let pageCount = 0;
    let headerSeen = false;
    const pages = [];

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try { parsed = JSON.parse(trimmed); } catch { return; }
      if (parsed.status === 'error') {
        proc.kill();
        reject(new Error(String(parsed.message || 'Java helper returned error')));
        return;
      }
      if (!headerSeen && parsed.status === 'success') {
        headerSeen = true;
        pageCount = typeof parsed.pageCount === 'number' ? parsed.pageCount : 0;
        return;
      }
      pages.push({
        page: String(parsed.page ?? ''),
        text: String(parsed.text ?? ''),
        footnotes: String(parsed.footnotes ?? ''),
      });
    };

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => {
      if (buffer.trim()) handleLine(buffer);
      if (code !== 0 && !headerSeen) {
        reject(new Error(`Java helper exited with code ${code}: ${stderr || 'no output'}`));
        return;
      }
      pages.sort((a, b) => Number.parseInt(a.page, 10) - Number.parseInt(b.page, 10));
      resolve({ bookId: String(bookId), pageCount, pages });
    });
    proc.on('error', (err) => reject(new Error(`Failed to spawn Java helper: ${err.message}`)));
  });
}

export async function getPageCount(bookId) {
  const install = detectShamelaPath();
  if (!install) return 0;
  const db = await openBookDb(install.path, bookId);
  if (!db) return 0;
  try {
    const row = db.prepare('SELECT COUNT(*) as c FROM page').get();
    return row?.c ?? 0;
  } finally {
    db.close();
  }
}

/**
 * Full table of contents for one book: Lucene heading text joined with the
 * book's own SQLite `title(id, page, parent)` table (page order, depth from
 * the parent chain) — same join Electron's `readShamelaTocJoined` performs.
 */
export async function readToc(bookId) {
  const install = detectShamelaPath();
  if (!install) throw new Error('مکتبہ شاملہ ۴ نہیں ملی۔');
  const titleIndex = path.join(install.path, 'database', 'store', 'title');
  if (!fs.existsSync(titleIndex)) throw new Error('database/store/title/ انڈیکس نہیں ملا۔');

  const titles = await invokeJavaHelperStream(install, 'readToc', [titleIndex, String(bookId)]);
  const titleById = new Map(titles.map((t) => [String(t.titleId ?? ''), String(t.text ?? '')]));

  const db = await openBookDb(install.path, bookId);
  if (!db) throw new Error('کتاب کی ڈیٹابیس نہیں ملی۔');
  try {
    const rows = db.prepare('SELECT id, page, parent FROM title ORDER BY page').all();
    const entries = [];
    for (const row of rows) {
      const id = String(row.id);
      const text = titleById.get(id);
      if (text === undefined) continue;

      let depth = 0;
      let pid = row.parent;
      while (pid > 0) {
        depth++;
        const parentRow = rows.find((r) => r.id === pid);
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

// ── Scanned-page-image PDFs (Book Translation source C) ─────────────────
//
// Some Shamela books are scanned-image PDFs rather than digitized text —
// `readPage`/`readBook` above return nothing useful for those. This ports
// `electron/shamela/catalogue.ts`'s `getBookPdfInfo`/`readBookPdfFile`
// (ADR-0007's same install layout: `pdf_links` on `database/master.db`'s
// `book` row, files under `<install>/pdf/`) into this bridge so a web
// session — not just the desktop app — can serve them. It is a direct port,
// not a call into `backend.catalog` (the vendored shamela-mcp package this
// bridge otherwise uses for catalogue browsing): `reader.mjs` already reads
// SQLite directly everywhere else in this file for the same reason (see the
// header comment) — shamela-mcp's own store is not reliably correct for
// every real book.

async function openMasterDb(installPath) {
  const dbPath = path.join(installPath, 'database', 'master.db');
  if (!fs.existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    const Database = (await import('better-sqlite3')).default;
    return new Database(dbPath, { readonly: true });
  }
}

const PDF_ROOT = (installPath) => path.join(installPath, 'pdf');

// Basename → absolute path under `pdf/`, built once per install and cached —
// see catalogue.ts's identical comment for why a basename key is safe here.
let pdfIndexCache = null;

function getPdfIndex(installPath) {
  const root = PDF_ROOT(installPath);
  if (pdfIndexCache && pdfIndexCache.root === root) return pdfIndexCache.map;

  const map = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf') && !map.has(entry.name)) {
        map.set(entry.name, full);
      }
    }
  };
  if (fs.existsSync(root)) walk(root);

  pdfIndexCache = { root, map };
  return map;
}

/** `{available, files: [{fileIndex, name, path, size}], coverPage}` for one book. */
export async function getBookPdfInfo(bookId) {
  const install = detectShamelaPath();
  if (!install) return { available: false, files: [], coverPage: null };

  const db = await openMasterDb(install.path);
  if (!db) return { available: false, files: [], coverPage: null };

  try {
    const row = db.prepare('SELECT pdf_links FROM book WHERE book_id = ?').get(Number(bookId));
    const files = [];
    let coverPage = null;
    if (row?.pdf_links) {
      try {
        const links = JSON.parse(row.pdf_links);
        const index = getPdfIndex(install.path);
        const rawFiles = Array.isArray(links.files) ? links.files : [];
        let fileIndex = 0;
        for (const raw of rawFiles) {
          const name = String(raw).split('/').pop()?.split('|')[0] ?? '';
          if (!name.toLowerCase().endsWith('.pdf')) continue;
          const diskPath = index.get(name);
          if (!diskPath) continue;
          let size = 0;
          try {
            size = fs.statSync(diskPath).size;
          } catch {
            /* ignore */
          }
          files.push({ fileIndex, name, path: diskPath, size });
          fileIndex += 1;
        }
        if (typeof links.cover === 'number' && links.cover > 0) coverPage = links.cover;
      } catch {
        /* malformed pdf_links — treat as no PDF */
      }
    }
    return { available: files.length > 0, files, coverPage };
  } finally {
    db.close();
  }
}

/**
 * Read one on-disk PDF's bytes by the `fileIndex` a prior `getBookPdfInfo`
 * call reported. The resolved path is re-validated against the install's
 * `pdf/` root before reading, so a request cannot walk outside it.
 */
export async function readBookPdfFile(bookId, fileIndex) {
  const install = detectShamelaPath();
  if (!install) return null;
  const info = await getBookPdfInfo(bookId);
  const file = info.files.find((f) => f.fileIndex === Number(fileIndex));
  if (!file) return null;

  const root = path.resolve(PDF_ROOT(install.path));
  const resolved = path.resolve(file.path);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  try {
    return fs.readFileSync(resolved);
  } catch {
    return null;
  }
}
