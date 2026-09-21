/**
 * Turath.io classical library client (ADR-0054).
 *
 * Provides desktop connectivity to api.turath.io:
 *  - searchTurath: classical search across ~8,500 books
 *  - readTurathPage: immutable page fetch
 *  - findTurathBook: catalogue / title lookup
 *
 * Includes 2-tier caching (memory LRU + persistent userData/turath-cache.json),
 * concurrency limiting (max 2 outbound requests), 12s timeout with AbortController,
 * and single retry on 429/5xx with Retry-After backoff.
 */
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { logger } from '../lib/logger.js';
import type { ShamelaSearchResult, ShamelaPageContent } from './shamelaNative.js';
import type { CloudBook } from './cloudClient.js';
import {
  extractTurathHits,
  normalizeTurathSearchHit,
  normalizeTurathPage,
  normalizeTurathBook,
  normalizeTurathAuthor,
  turathPageLabel,
  type TurathRawPage,
  type TurathRawBook,
  type TurathRawAuthor,
} from '../../supabase/functions/_shared/turath.js';

const log = logger.child('shamela/turathClient');

export const TURATH_BASE_URL = 'https://api.turath.io';
export const TURATH_USER_AGENT = 'EasyEditor-Agent/1.0 (scholarly research; contact agent@easyeditor.app)';
export const TURATH_REQUEST_TIMEOUT_MS = 12_000;
export const TURATH_PAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const TURATH_SEARCH_TTL_MS = 24 * 60 * 60 * 1000;   // 24 hours
export const TURATH_MAX_CACHE_ENTRIES = 500;

/**
 * NOTE on `pageNumber`: for Turath it is the SEQUENTIAL page index (`page_id`),
 * because that is the only coordinate `/page?pg=` accepts — the id
 * `turath:<book>:<pageNumber>` handed to the model must round-trip through
 * `read_shamela_page`. The PRINTED volume/page a scholar cites is carried
 * separately in `volume` / `printedPage` / `pageLabel`.
 */
export interface TurathSearchResult extends ShamelaSearchResult {
  id: string;
  author: string;
  volume?: number;
  printedPage: number;
  /** Citation label, e.g. "ج2، ص129". */
  pageLabel: string;
  content: string;
  headings: string[];
}

export interface TurathPageContent extends ShamelaPageContent {
  volume?: number;
  printedPage: number;
  pageLabel: string;
  content: string;
  headings: string[];
}

export type { CloudBook };

// ─── 2-Tier Cache ──────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  data: T;
  expiresAt: number;
}

/**
 * Bump when the cached value SHAPE changes. v1 files were written by a client
 * whose search parser found nothing against the real API, so they are full of
 * cached-empty results that would otherwise be served for another 24h.
 */
const CACHE_FILE_VERSION = 2;

interface PersistedCacheFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

let memoryCache = new Map<string, CacheEntry>();
let cacheLoaded = false;
let saveDebounceTimer: NodeJS.Timeout | null = null;
let customCachePath: string | null = null;

export function _setCustomCachePath(p: string | null): void {
  customCachePath = p;
}

function getCacheFilePath(): string {
  if (customCachePath) return customCachePath;
  try {
    if (typeof app !== 'undefined' && app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'turath-cache.json');
    }
  } catch {
    // Non-electron test or early startup fallback
  }
  return path.join(process.cwd(), '.turath-cache.json');
}

function loadCacheIfNeeded(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const filePath = getCacheFilePath();
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as PersistedCacheFile;
    if (parsed && parsed.version === CACHE_FILE_VERSION && typeof parsed.entries === 'object') {
      const now = Date.now();
      for (const [k, v] of Object.entries(parsed.entries)) {
        if (v && typeof v.expiresAt === 'number' && v.expiresAt > now) {
          memoryCache.set(k, v);
        }
      }
    }
  } catch (err) {
    log.warn('Could not read turath-cache.json', { message: (err as Error).message });
  }
}

function persistCacheToDisk(): void {
  try {
    const filePath = getCacheFilePath();
    const now = Date.now();
    const entries: Record<string, CacheEntry> = {};
    for (const [k, v] of memoryCache.entries()) {
      if (v.expiresAt > now) {
        entries[k] = v;
      }
    }
    const fileContent: PersistedCacheFile = { version: CACHE_FILE_VERSION, entries };
    const serialized = JSON.stringify(fileContent);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmpPath, serialized, 'utf8');
    try {
      fs.renameSync(tmpPath, filePath);
    } catch {
      fs.writeFileSync(filePath, serialized, 'utf8');
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  } catch (err) {
    log.warn('Could not persist turath-cache.json', { message: (err as Error).message });
  }
}

function scheduleSaveCache(): void {
  if (saveDebounceTimer) return;
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    persistCacheToDisk();
  }, 500);
  if (typeof saveDebounceTimer.unref === 'function') {
    saveDebounceTimer.unref();
  }
}

function getCache<T>(key: string): T | undefined {
  loadCacheIfNeeded();
  const entry = memoryCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return undefined;
  }
  // Refresh LRU order: delete and re-insert at end
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  loadCacheIfNeeded();
  if (memoryCache.has(key)) {
    memoryCache.delete(key);
  } else if (memoryCache.size >= TURATH_MAX_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey !== undefined) {
      memoryCache.delete(oldestKey);
    }
  }
  memoryCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  scheduleSaveCache();
}

/** Synchronously flush debounced cache writes for deterministic testing. */
export function _flushTurathCache(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  persistCacheToDisk();
}

/** Clears memory cache and forces reload from disk. */
export function _reloadTurathCache(): void {
  memoryCache.clear();
  cacheLoaded = false;
  loadCacheIfNeeded();
}

/** Reset cache for test isolation. */
export function _resetTurathCache(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  memoryCache.clear();
  cacheLoaded = false;
  activeRequests = 0;
  waitingQueue.length = 0;
  try {
    const filePath = getCacheFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }
}

// ─── Network & Concurrency ──────────────────────────────────────────────────

let activeRequests = 0;
const waitingQueue: Array<() => void> = [];

async function acquireSlot(): Promise<() => void> {
  if (activeRequests < 2) {
    activeRequests++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        activeRequests--;
        const next = waitingQueue.shift();
        if (next) next();
      }
    };
  }

  return new Promise<() => void>((resolve) => {
    waitingQueue.push(() => {
      activeRequests++;
      let released = false;
      resolve(() => {
        if (!released) {
          released = true;
          activeRequests--;
          const next = waitingQueue.shift();
          if (next) next();
        }
      });
    });
  });
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 200;
  const num = Number(header);
  if (!Number.isNaN(num) && num >= 0) {
    return Math.min(num * 1000, 10_000);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(0, dateMs - Date.now()), 10_000);
  }
  return 200;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURATH_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': TURATH_USER_AGENT,
        Accept: 'application/json',
        ...init?.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function turathRequest<T>(url: string): Promise<T> {
  const release = await acquireSlot();
  try {
    let res = await fetchWithTimeout(url);

    // Single retry on 429 or 5xx
    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'));
      log.warn('Turath rate limit or server error, retrying', {
        status: res.status,
        retryAfterMs,
        url,
      });
      await delay(retryAfterMs);
      res = await fetchWithTimeout(url);
    }

    if (!res.ok) {
      throw new Error(`Turath API error: HTTP ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as T;
  } finally {
    release();
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────
//
// Endpoints (community SDK + verified live against api.turath.io, ver=3):
//   GET /search?q=…&ver=3          → { count, data: [ {book_id, cat_id, author_id, meta, snip, text} ] }
//   GET /page?book_id=…&pg=…&ver=3 → { meta: "<json>", text }        (pg = SEQUENTIAL page_id)
//   GET /book?id=…&ver=3           → { meta: { id, name, author_id, cat_id, … } }
//   GET /author?id=…&ver=3         → { id, name, biography, death }  ({} for an unknown id, HTTP 200)
// The path forms `/page/<id>/<pg>` and `/book/<id>` that an earlier version
// called return 404 — they never worked, and mocked-fetch tests hid it.

function turathUrl(endpoint: string, params: Record<string, string | number>): string {
  const url = new URL(`${TURATH_BASE_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('ver', '3');
  return url.toString();
}

/**
 * Searches Turath.io classical library with optional bookId filtering and limit.
 */
export async function searchTurath(
  query: string,
  limit = 8,
  bookIds?: number[],
): Promise<TurathSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const safeLimit = Math.max(1, limit);
  const scoped = (bookIds ?? []).filter(Number.isFinite);
  const scopedKey = scoped.slice().sort((a, b) => a - b).join(',');
  const cacheKey = `search:${cleanQuery.toLowerCase()}:${safeLimit}:${scopedKey}`;

  const cached = getCache<TurathSearchResult[]>(cacheKey);
  if (cached) return cached;

  const rawData = await turathRequest<unknown>(turathUrl('search', { q: cleanQuery }));

  let normalized = extractTurathHits(rawData).map(normalizeTurathSearchHit);
  if (scoped.length > 0) {
    normalized = normalized.filter((h) => scoped.includes(Number(h.book_id)));
  }

  const results: TurathSearchResult[] = normalized.slice(0, safeLimit).map((h) => ({
    // page_id is the address `read_shamela_page` needs; fall back to the
    // printed page only if Turath ever omits it (it never has in practice).
    id: `turath:${h.book_id}:${h.page_id ?? h.page}`,
    bookId: h.book_id,
    bookTitle: h.book_name,
    author: h.author_name,
    pageNumber: h.page_id ?? h.page,
    volume: h.vol,
    printedPage: h.page,
    pageLabel: turathPageLabel(h.page, h.vol),
    snippet: h.snippet,
    content: h.text,
    score: 1,
    headings: h.headings,
  }));

  setCache(cacheKey, results, TURATH_SEARCH_TTL_MS);
  return results;
}

/**
 * Reads a single page from Turath.io classical library.
 * `pageNumber` is the sequential page index (`page_id`) — see TurathSearchResult.
 */
export async function readTurathPage(
  bookId: string | number,
  pageNumber: number,
): Promise<TurathPageContent> {
  const cleanBookId = String(bookId).replace(/^turath:/i, '').trim();
  if (!/^\d+$/.test(cleanBookId)) {
    throw new Error(`Turath bookId must be numeric, got: ${bookId}`);
  }

  const cleanPage = Math.trunc(Number(pageNumber));
  if (!Number.isFinite(cleanPage) || cleanPage <= 0) {
    throw new Error(`Invalid page number: ${pageNumber}`);
  }

  const cacheKey = `page:${cleanBookId}:${cleanPage}`;
  const cached = getCache<TurathPageContent>(cacheKey);
  if (cached) return cached;

  const raw = await turathRequest<TurathRawPage>(turathUrl('page', { book_id: cleanBookId, pg: cleanPage }));

  // Turath answers an out-of-range page with an empty object, not an error.
  if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string') {
    throw new Error(`Turath page not found: book ${cleanBookId}, page ${cleanPage}`);
  }

  const page = normalizeTurathPage(raw, cleanBookId);
  const result: TurathPageContent = {
    bookId: cleanBookId,
    pageNumber: cleanPage,
    volume: page.vol,
    printedPage: page.page,
    pageLabel: page.label,
    text: page.text,
    content: page.text,
    headings: page.headings,
    footnotes: undefined,
  };

  setCache(cacheKey, result, TURATH_PAGE_TTL_MS);
  return result;
}

/** Resolves an author id to name + hijri death year. Never throws: a book is still useful without it. */
async function lookupAuthor(authorId: string | undefined): Promise<{ name: string | null; deathYear: number | null }> {
  if (!authorId) return { name: null, deathYear: null };
  const cacheKey = `author:${authorId}`;
  const cached = getCache<{ name: string | null; deathYear: number | null }>(cacheKey);
  if (cached) return cached;
  try {
    const a = normalizeTurathAuthor(await turathRequest<TurathRawAuthor>(turathUrl('author', { id: authorId })));
    const out = { name: a.name || null, deathYear: a.death_year };
    // An unknown id returns {} (HTTP 200): not worth remembering as a real answer.
    if (out.name) setCache(cacheKey, out, TURATH_PAGE_TTL_MS);
    return out;
  } catch (err) {
    log.warn('Turath author lookup failed', { authorId, message: (err as Error).message });
    return { name: null, deathYear: null };
  }
}

/**
 * Looks up a book in the Turath.io catalogue: by numeric id (`/book` + `/author`),
 * or by title/author text (distinct books among the search hits — Turath has no
 * catalogue-search endpoint).
 */
export async function findTurathBook(
  query: string,
  limit = 15,
): Promise<CloudBook[]> {
  const cleanQuery = query.replace(/^turath:/i, '').trim();
  if (!cleanQuery) return [];

  const safeLimit = Math.max(1, limit);
  const cacheKey = `book:${cleanQuery.toLowerCase()}:${safeLimit}`;

  const cached = getCache<CloudBook[]>(cacheKey);
  if (cached) return cached;

  // A bare number is a book id.
  if (/^\d+$/.test(cleanQuery)) {
    let raw: TurathRawBook;
    try {
      raw = await turathRequest<TurathRawBook>(turathUrl('book', { id: cleanQuery }));
    } catch (err) {
      // The live API answers an unknown book id with HTTP 404 `{}`. "Not found"
      // is an answer, not a failure — anything else (5xx, timeout) still throws.
      if (err instanceof Error && /HTTP 404/.test(err.message)) return [];
      throw err;
    }
    if (!raw?.meta || raw.meta.id == null) return [];
    const book = normalizeTurathBook(raw);
    const author = await lookupAuthor(book.author_id);
    const results: CloudBook[] = [{
      id: Number(book.book_id),
      title: book.title,
      author: author.name,
      deathYear: author.deathYear,
    }];
    setCache(cacheKey, results, TURATH_SEARCH_TTL_MS);
    return results;
  }

  // Otherwise: the distinct books that a text search surfaces.
  const rawSearch = await turathRequest<unknown>(turathUrl('search', { q: cleanQuery }));
  const booksMap = new Map<number, CloudBook>();
  for (const hit of extractTurathHits(rawSearch)) {
    const norm = normalizeTurathSearchHit(hit);
    const id = Number(norm.book_id);
    if (id && !booksMap.has(id)) {
      // Search hits carry the author NAME but not the death year; leaving it
      // null is honest, and one /author call per book would multiply latency.
      booksMap.set(id, { id, title: norm.book_name, author: norm.author_name || null, deathYear: null });
    }
  }

  const results = Array.from(booksMap.values()).slice(0, safeLimit);
  setCache(cacheKey, results, TURATH_SEARCH_TTL_MS);
  return results;
}
