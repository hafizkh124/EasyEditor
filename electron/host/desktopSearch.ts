/**
 * M13 Phase 2 (ADR-0059) — "search my computer".
 *
 * Level 1 is the Windows Search index (the same one Explorer's search box
 * uses): free, already built by Windows, answers in ~100 ms, and supports
 * both file-name and full-text (CONTAINS) queries. It is queried over OLE DB
 * from a one-shot PowerShell process. The SQL is assembled HERE from
 * sanitised pieces — an allow-listed extension set, a validated folder, and a
 * search term with every quote / wildcard character removed — and the script
 * only executes the string it is given; model text is never evaluated as
 * script (same rule as wordBridge.ps1, SPEC-M8 §3.3).
 *
 * When the index is unavailable (service stopped, folder not indexed) a
 * bounded Node directory walk over the user's own folders answers file-name
 * queries instead (5 s / 200 hits).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../lib/logger.js';

const log = logger.child('host/desktopSearch');

/** Document types the search may return. Never executables or app data. */
export const SEARCHABLE_EXTS = [
  '.docx', '.doc', '.rtf', '.odt', '.pdf', '.txt', '.md', '.epub',
  '.xlsx', '.xls', '.csv', '.pptx', '.ppt', '.inp',
] as const;

export type SearchMode = 'filename' | 'content' | 'both';

export interface DesktopHit {
  path: string;
  name: string;
  ext: string;
  size: number;
  modified: string | null;
  source: 'windows-search' | 'walk';
}

export interface DesktopSearchOptions {
  query: string;
  mode?: SearchMode;
  /** Subset of SEARCHABLE_EXTS, with or without the dot. Default: all. */
  extensions?: string[];
  /** Absolute folder to restrict to. */
  folder?: string;
  limit?: number;
}

export interface DesktopSearchResult {
  hits: DesktopHit[];
  source: 'windows-search' | 'walk' | 'none';
  note?: string;
}

// ── pure helpers (unit-tested) ────────────────────────────────────────────

/** Harakat, tatweel, superscript alef, and zero-width marks. */
// Zero-width marks are an alternation, not in the class: a ZWJ inside a
// character class is a "joined sequence" (no-misleading-character-class).
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u0640]|\u200C|\u200D|\u200E|\u200F/g;

/**
 * Spelling variants of one term, for an index that matches literally: the
 * term as typed, without diacritics (فتویٰ → فتوی), and with the Arabic
 * letter forms swapped for the Urdu ones and back (ي/ی, ك/ک, ه/ہ, ة/ۃ).
 */
export function termVariants(term: string): string[] {
  const base = term.trim();
  const bare = base.replace(ARABIC_MARKS, '');
  const toArabic = bare.replace(/\u06CC/g, '\u064A').replace(/\u06A9/g, '\u0643').replace(/\u06C1/g, '\u0647').replace(/\u06C3/g, '\u0629');
  const toUrdu = bare.replace(/\u064A/g, '\u06CC').replace(/\u0643/g, '\u06A9').replace(/\u0647/g, '\u06C1').replace(/\u0629/g, '\u06C3');
  // Alef-maqsura (ى) is commonly typed for Urdu final ی.
  const maqsura = toUrdu.replace(/\u06CC(?=\s|$)/g, '\u0649');
  return [...new Set([base, bare, toArabic, toUrdu, maqsura].filter((v) => v.length > 0))];
}

/** One canonical folding for in-process matching (the walk fallback). */
export function foldForMatch(s: string): string {
  return s
    .replace(ARABIC_MARKS, '')
    .replace(/[\u064A\u0649]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/[\u0647\u06BE]/g, '\u06C1')
    .replace(/\u0629/g, '\u06C3')
    .toLowerCase();
}

/**
 * A search term safe inside a Windows Search SQL string literal: quotes,
 * LIKE wildcards, brackets and control characters removed; length capped.
 */
export function sanitizeSearchTerm(q: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return q.replace(/['"%_[\]\\;*?\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function normaliseExtensions(exts: string[] | undefined): string[] {
  if (!exts || exts.length === 0) return [...SEARCHABLE_EXTS];
  const allowed = new Set<string>(SEARCHABLE_EXTS);
  const out = exts
    .map((e) => `.${String(e).trim().toLowerCase().replace(/^\.+/, '')}`)
    .filter((e) => allowed.has(e));
  return [...new Set(out)];
}

/** `file:D:/Books` — or null if the folder is not an existing absolute directory. */
export function folderScope(folder: string | undefined): string | null {
  if (!folder) return null;
  if (!path.isAbsolute(folder)) return null;
  const abs = path.resolve(folder);
  try { if (!fs.statSync(abs).isDirectory()) return null; } catch { return null; }
  if (/['"]/.test(abs)) return null;
  return `file:${abs.replace(/\\/g, '/')}`;
}

/** Build the Windows Search SQL. Returns null when there is nothing safe to search for. */
export function buildWindowsSearchSql(o: { term: string; mode: SearchMode; exts: string[]; scope: string | null; limit: number }): string | null {
  const term = sanitizeSearchTerm(o.term);
  if (!term || o.exts.length === 0) return null;
  const top = Math.min(Math.max(Math.floor(o.limit), 1), 200);
  // Windows Search SQL has no IN (…) — it fails with 0x80040E14 (confirmed live).
  const extList = o.exts.map((e) => `System.FileExtension = '${e}'`).join(' OR ');
  const nameClauses = termVariants(term).map((v) => `System.FileName LIKE '%${v}%'`);
  const contentClause = `CONTAINS(*, '"${term}"')`;
  const match =
    o.mode === 'filename' ? `(${nameClauses.join(' OR ')})`
    : o.mode === 'content' ? contentClause
    : `(${[...nameClauses, contentClause].join(' OR ')})`;
  const scope = o.scope ? `SCOPE='${o.scope}'` : `SCOPE='file:'`;
  return (
    `SELECT TOP ${top} System.ItemPathDisplay, System.Size, System.DateModified FROM SystemIndex ` +
    `WHERE ${scope} AND (${extList}) AND ${match} ` +
    `AND NOT System.FileName LIKE '~$%' ORDER BY System.DateModified DESC`
  );
}

// ── Level 1: Windows Search over OLE DB ───────────────────────────────────

/** Executes the given SQL and prints the rows as JSON. Reads its input as data from stdin. */
const WINDOWS_SEARCH_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
$c = New-Object -ComObject ADODB.Connection
try {
  $c.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
  $rs = $c.Execute([string]$req.sql)
  $rows = New-Object System.Collections.ArrayList
  while (-not $rs.EOF) {
    $p = $rs.Fields.Item('System.ItemPathDisplay').Value
    $s = $rs.Fields.Item('System.Size').Value
    $m = $rs.Fields.Item('System.DateModified').Value
    $mod = $null
    if ($m) { try { $mod = ([datetime]$m).ToString('o') } catch { } }
    [void]$rows.Add(@{ path = [string]$p; size = [double]$s; modified = $mod })
    $rs.MoveNext()
  }
  Write-Output (ConvertTo-Json -Compress -Depth 4 -InputObject @{ ok = $true; rows = $rows.ToArray() })
} catch {
  Write-Output (ConvertTo-Json -Compress -InputObject @{ ok = $false; error = $_.Exception.Message })
} finally {
  try { $c.Close() } catch { }
}
`;

function encodePs(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function runWindowsSearch(sql: string, timeoutMs = 15_000): Promise<Array<{ path: string; size: number; modified: string | null }>> {
  if (process.platform !== 'win32') throw new Error('Windows Search is only available on Windows');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePs(WINDOWS_SEARCH_PS)], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Windows Search timed out after ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
      try {
        const parsed = JSON.parse(line) as { ok: boolean; rows?: Array<{ path: string; size: number; modified: string | null }> | { path: string }; error?: string };
        if (!parsed.ok) { reject(new Error(parsed.error || 'Windows Search failed')); return; }
        // ConvertTo-Json collapses a one-element array to an object.
        const rows = Array.isArray(parsed.rows) ? parsed.rows : parsed.rows ? [parsed.rows as { path: string; size: number; modified: string | null }] : [];
        resolve(rows);
      } catch {
        reject(new Error(`Windows Search returned no result${err ? `: ${err.slice(0, 200)}` : ''}`));
      }
    });
    child.stdin.end(JSON.stringify({ sql }), 'utf8');
  });
}

// ── Level 1b: bounded directory walk (file names only) ─────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'appdata', '$recycle.bin', 'system volume information',
  'windows', 'program files', 'program files (x86)', 'programdata', '.cache', '.easyeditor',
]);

export function defaultWalkRoots(): string[] {
  const home = os.homedir();
  return ['Desktop', 'Documents', 'Downloads', path.join('OneDrive', 'Documents'), path.join('OneDrive', 'Desktop')]
    .map((d) => path.join(home, d))
    .filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

export function walkSearch(o: { term: string; exts: string[]; roots: string[]; limit: number; deadlineMs?: number }): DesktopHit[] {
  const needles = [...new Set(termVariants(o.term).map(foldForMatch))].filter(Boolean);
  if (!needles.length) return [];
  const exts = new Set(o.exts);
  const hits: DesktopHit[] = [];
  const deadline = Date.now() + (o.deadlineMs ?? 5_000);
  const queue = [...o.roots];
  while (queue.length && hits.length < o.limit && Date.now() < deadline) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (hits.length >= o.limit) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // Dot-folders (incl. EasyEditor's own .easyeditor backups) are skipped.
        if (!SKIP_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('.')) queue.push(full);
        continue;
      }
      if (!e.isFile() || e.name.startsWith('~$')) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!exts.has(ext)) continue;
      const folded = foldForMatch(e.name);
      if (!needles.some((n) => folded.includes(n))) continue;
      let st: fs.Stats | null = null;
      try { st = fs.statSync(full); } catch { /* vanished */ }
      hits.push({ path: full, name: e.name, ext, size: st?.size ?? 0, modified: st ? st.mtime.toISOString() : null, source: 'walk' });
    }
  }
  return hits;
}

// ── public entry point ─────────────────────────────────────────────────────

/** EasyEditor's own snapshot copies (backups / task history) — never a result. */
export function isInternalCopy(p: string): boolean {
  return /[\\/]\.easyeditor[\\/]/i.test(p);
}

export async function searchMyComputer(o: DesktopSearchOptions, extraRoots: string[] = []): Promise<DesktopSearchResult> {
  const mode: SearchMode = o.mode === 'content' || o.mode === 'both' ? o.mode : 'filename';
  const exts = normaliseExtensions(o.extensions);
  if (!exts.length) return { hits: [], source: 'none', note: `none of those file types can be searched — allowed: ${SEARCHABLE_EXTS.join(' ')}` };
  const limit = Math.min(Math.max(o.limit ?? 30, 1), 200);
  if (o.folder && !folderScope(o.folder)) {
    return { hits: [], source: 'none', note: `folder not found (it must be a full path to an existing folder): ${o.folder}` };
  }
  // Over-fetch so EasyEditor's own backup/history copies can be dropped.
  const sql = buildWindowsSearchSql({ term: o.query, mode, exts, scope: folderScope(o.folder), limit: Math.min(limit * 2, 200) });
  if (!sql) return { hits: [], source: 'none', note: 'the search term is empty after removing quotes and wildcards' };

  let indexError: string | undefined;
  try {
    const rows = await runWindowsSearch(sql);
    const hits = rows
      .filter((r) => r.path && !isInternalCopy(r.path))
      .slice(0, limit)
      .map((r): DesktopHit => ({
        path: r.path, name: path.basename(r.path), ext: path.extname(r.path).toLowerCase(),
        size: Number(r.size) || 0, modified: r.modified ?? null, source: 'windows-search',
      }));
    if (hits.length || mode !== 'filename') return { hits, source: 'windows-search' };
  } catch (err) {
    indexError = (err as Error).message;
    log.warn('Windows Search unavailable', { message: indexError });
  }

  // Fallback / second chance for file names: walk the user's own folders.
  if (mode === 'content') {
    return { hits: [], source: 'none', note: `the Windows Search index is not available (${indexError}), so file contents cannot be searched — try a file-name search` };
  }
  const roots = o.folder ? [path.resolve(o.folder)] : [...new Set([...defaultWalkRoots(), ...extraRoots])];
  const hits = walkSearch({ term: sanitizeSearchTerm(o.query), exts, roots, limit });
  return {
    hits,
    source: 'walk',
    note: indexError
      ? `Windows Search index unavailable (${indexError}); searched ${roots.length} folder(s) directly by file name.`
      : `Not found in the Windows Search index; searched ${roots.length} folder(s) directly by file name.`,
  };
}
