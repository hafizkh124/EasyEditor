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
  parseTurathMeta,
  normalizeTurathSearchHit,
  normalizeTurathBook,
  type TurathRawSearchHit,
  type TurathRawBook,
} from '../../supabase/functions/_shared/turath.js';

const log = logger.child('shamela/turathClient');

export const TURATH_BASE_URL = 'https://api.turath.io';
export const TURATH_USER_AGENT = 'EasyEditor-Agent/1.0 (scholarly research; contact agent@easyeditor.app)';
export const TURATH_REQUEST_TIMEOUT_MS = 12_000;
export const TURATH_PAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const TURATH_SEARCH_TTL_MS = 24 * 60 * 60 * 1000;   // 24 hours
export const TURATH_MAX_CACHE_ENTRIES = 500;

export interface TurathSearchResult extends ShamelaSearchResult {
  id: string;
  author: string;
  volume: number;
  content: string;
  headings: string[];
}

export interface TurathPageContent extends ShamelaPageContent {
  volume: number;
  content: string;
  headings: string[];
}

export type { CloudBook };

// ─── 2-Tier Cache ──────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  data: T;
  expiresAt: number;
}

interface PersistedCacheFile {
  version: 1;
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
    if (parsed && typeof parsed.entries === 'object') {
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
    const fileContent: PersistedCacheFile = { version: 1, entries };
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

  const url = new URL(`${TURATH_BASE_URL}/search`);
  url.searchParams.set('q', cleanQuery);
  url.searchParams.set('ver', '3');

  const rawData = await turathRequest<unknown>(url.toString());
  const rawHits: TurathRawSearchHit[] = Array.isArray(rawData)
    ? (rawData as TurathRawSearchHit[])
    : rawData && typeof rawData === 'object' && Array.isArray((rawData as { results?: unknown[] }).results)
    ? ((rawData as { results: TurathRawSearchHit[] }).results)
    : [];

  let normalized = rawHits.map(normalizeTurathSearchHit);
  if (scoped.length > 0) {
    normalized = normalized.filter((h) => scoped.includes(Number(h.book_id)));
  }

  const results: TurathSearchResult[] = normalized.slice(0, safeLimit).map((h) => ({
    id: `turath:${h.book_id}:${h.page}`,
    bookId: h.book_id,
    bookTitle: h.book_name,
    author: h.author_name,
    pageNumber: h.page,
    volume: h.vol,
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
 */
export async function readTurathPage(
  bookId: string | number,
  pageNumber: number,
): Promise<TurathPageContent> {
  const cleanBookId = String(bookId).replace(/^turath:/i, '').trim();
  if (!cleanBookId) {
    throw new Error('Turath bookId is required');
  }

  const cleanPage = Math.trunc(Number(pageNumber));
  if (!Number.isFinite(cleanPage) || cleanPage <= 0) {
    throw new Error(`Invalid page number: ${pageNumber}`);
  }

  const cacheKey = `page:${cleanBookId}:${cleanPage}`;
  const cached = getCache<TurathPageContent>(cacheKey);
  if (cached) return cached;

  const url = `${TURATH_BASE_URL}/page/${encodeURIComponent(cleanBookId)}/${encodeURIComponent(cleanPage)}`;
  const rawHit = await turathRequest<TurathRawSearchHit>(url);

  if (!rawHit || typeof rawHit !== 'object') {
    throw new Error(`Turath page not found: book ${cleanBookId}, page ${cleanPage}`);
  }

  const normalized = normalizeTurathSearchHit(rawHit);
  const result: TurathPageContent = {
    bookId: cleanBookId,
    pageNumber: cleanPage,
    volume: normalized.vol,
    text: normalized.text,
    content: normalized.text,
    headings: normalized.headings,
    footnotes: undefined,
  };

  setCache(cacheKey, result, TURATH_PAGE_TTL_MS);
  return result;
}

/**
 * Looks up a book in Turath.io catalogue by ID or query string.
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

  const extractDeathYear = (metaRaw: unknown): number | null => {
    const meta = parseTurathMeta(metaRaw);
    const death = meta.author_death != null ? Number(meta.author_death) : null;
    return death && Number.isFinite(death) ? Math.trunc(death) : null;
  };

  // Try direct /book/:id or /book/:query endpoint first
  try {
    const url = `${TURATH_BASE_URL}/book/${encodeURIComponent(cleanQuery)}`;
    const raw = await turathRequest<unknown>(url);

    let books: TurathRawBook[] = [];
    if (Array.isArray(raw)) {
      books = raw as TurathRawBook[];
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.books)) {
        books = obj.books as TurathRawBook[];
      } else if (obj.book_id != null || obj.name != null || obj.book_name != null) {
        books = [raw as TurathRawBook];
      }
    }

    if (books.length > 0) {
      const results: CloudBook[] = books.slice(0, safeLimit).map((b) => {
        const norm = normalizeTurathBook(b);
        return {
          id: Number(norm.book_id),
          title: norm.title,
          author: norm.author || null,
          deathYear: extractDeathYear(b.meta),
        };
      });
      setCache(cacheKey, results, TURATH_SEARCH_TTL_MS);
      return results;
    }
  } catch (err) {
    const is404 = err instanceof Error && /404/.test(err.message);
    if (/^\d+$/.test(cleanQuery)) {
      if (is404) return [];
      throw err;
    }
  }

  // Fallback to searching Turath catalogue via search hits
  const searchUrl = new URL(`${TURATH_BASE_URL}/search`);
  searchUrl.searchParams.set('q', cleanQuery);
  searchUrl.searchParams.set('ver', '3');

  const rawSearch = await turathRequest<unknown>(searchUrl.toString());
  const rawHits: TurathRawSearchHit[] = Array.isArray(rawSearch)
    ? (rawSearch as TurathRawSearchHit[])
    : rawSearch && typeof rawSearch === 'object' && Array.isArray((rawSearch as { results?: unknown[] }).results)
    ? ((rawSearch as { results: TurathRawSearchHit[] }).results)
    : [];

  const booksMap = new Map<number, CloudBook>();
  for (const hit of rawHits) {
    const norm = normalizeTurathSearchHit(hit);
    const id = Number(norm.book_id);
    if (id && !booksMap.has(id)) {
      booksMap.set(id, {
        id,
        title: norm.book_name,
        author: norm.author_name || null,
        deathYear: extractDeathYear(hit.meta),
      });
    }
  }

  const results = Array.from(booksMap.values()).slice(0, safeLimit);
  setCache(cacheKey, results, TURATH_SEARCH_TTL_MS);
  return results;
}
