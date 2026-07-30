import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShamelaStatus {
  installed: boolean;
  path: string | null;
  version?: string;
  jrePath?: string | null;
  lucenePath?: string | null;
  masterDbPath?: string | null;
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
  volume?: string;
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
  // In production: resources/bin/shamela-helper.jar (packaged with app)
  const prodPath = path.join(process.resourcesPath || '', 'bin', 'shamela-helper.jar');
  if (fs.existsSync(prodPath)) return prodPath;

  // In dev: electron/shamela/java/shamela-helper.jar (build output)
  const devPath = path.join(__dirname, 'java', 'shamela-helper.jar');
  if (fs.existsSync(devPath)) return devPath;

  throw new Error('shamela-helper.jar نہیں ملا۔ پہلے scripts/build-shamela-helper چلائیں۔');
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
    console.error('[shamelaNative] search error:', err);
    throw err;
  }
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
    console.error('[shamelaNative] read error:', err);
    throw err;
  }
}
