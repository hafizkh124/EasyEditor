// @vitest-environment node
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  searchTurath,
  readTurathPage,
  findTurathBook,
  _resetTurathCache,
  _flushTurathCache,
  _reloadTurathCache,
  _setCustomCachePath,
  TURATH_USER_AGENT,
  TURATH_REQUEST_TIMEOUT_MS,
  TURATH_MAX_CACHE_ENTRIES,
} from '../../electron/shamela/turathClient.js';
import { turathFetchFake, FIXTURE_BOOK_ID, FIXTURE_PAGE_ID } from './helpers/turathApiFake';

/**
 * Every test here talks to `turathFetchFake`, which mirrors the REAL
 * api.turath.io (paths, parameter names, `{count, data}` envelope, 404 `{}` for
 * anything else). See the helper for why a permissive mock is not acceptable:
 * the first version of this client called two URLs that 404 in production and
 * parsed an envelope that does not exist, and all of its tests passed.
 */
describe('turathClient', () => {
  const originalFetch = global.fetch;
  let testCacheFile: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testCacheFile = path.join(os.tmpdir(), `turath-test-cache-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    _setCustomCachePath(testCacheFile);
    _resetTurathCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _resetTurathCache();
    _setCustomCachePath(null);
    vi.useRealTimers();
    try {
      if (fs.existsSync(testCacheFile)) fs.unlinkSync(testCacheFile);
    } catch {
      // ignore
    }
  });

  describe('searchTurath', () => {
    it('reads the real {count, data} envelope and normalizes hits', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      const hits = await searchTurath('الربا', 10);
      // Regression: the envelope is {count, data}. A parser that only looked
      // for a bare array or `.results` returned [] for every real search.
      expect(hits).toHaveLength(4);

      const first = hits[0];
      expect(first.bookId).toBe('127708');
      expect(first.bookTitle).toContain('زاد المستقنع');
      expect(first.author).toBe('عبد الكريم اللاحم');
      expect(first.score).toBe(1);
    });

    it('addresses a hit by its sequential page_id but labels it with the printed volume/page', async () => {
      global.fetch = turathFetchFake().fetch as unknown as typeof fetch;
      const [first] = await searchTurath('الربا', 10);

      // page_id 724 is what /page?pg= and the reader take …
      expect(first.pageNumber).toBe(724);
      expect(first.id).toBe('turath:127708:724');
      // … while the scholar cites the PRINTED coordinates: volume 2, page 129.
      expect(first.volume).toBe(2);
      expect(first.printedPage).toBe(129);
      expect(first.pageLabel).toBe('ج2، ص129');
    });

    it('strips every kind of Turath markup from snippet and content', async () => {
      global.fetch = turathFetchFake().fetch as unknown as typeof fetch;
      const hits = await searchTurath('الربا', 10);
      for (const h of hits) {
        expect(h.snippet).not.toMatch(/<[^>]+>/);
        expect(h.content).not.toMatch(/<[^>]+>/);
      }
      // The heading <span data-type="title"> wraps real text — it must survive.
      expect(hits[0].content).toContain('المبحث الرابع من يجري بينهم الربا');
    });

    it('calls /search with the query and ver=3, sending the identifying headers', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      await searchTurath('طهارة', 5);
      expect(api.calls).toHaveLength(1);
      expect(api.calls[0].path).toBe('/search');
      expect(api.calls[0].params).toMatchObject({ q: 'طهارة', ver: '3' });
      expect(api.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'User-Agent': TURATH_USER_AGENT, Accept: 'application/json' }),
        }),
      );
    });

    it('returns [] for a query with no matches', async () => {
      global.fetch = turathFetchFake({ search: { count: 0, data: [] } }).fetch as unknown as typeof fetch;
      expect(await searchTurath('zzzqqq', 5)).toEqual([]);
    });

    it('returns empty array immediately for empty or whitespace query without network call', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;
      expect(await searchTurath('')).toEqual([]);
      expect(await searchTurath('   ')).toEqual([]);
      expect(api.fetch).not.toHaveBeenCalled();
    });

    it('filters results by scoped bookIds and enforces limit', async () => {
      global.fetch = turathFetchFake().fetch as unknown as typeof fetch;
      const hits = await searchTurath('الربا', 1, [832]);
      expect(hits).toHaveLength(1);
      expect(hits[0].bookId).toBe('832');
    });

    it('caches search results and returns cached hits on repeated query', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      const hits1 = await searchTurath('صلاة', 5);
      expect(api.fetch).toHaveBeenCalledTimes(1);
      expect(hits1).toHaveLength(4);

      const hits2 = await searchTurath('صلاة', 5);
      expect(api.fetch).toHaveBeenCalledTimes(1);
      expect(hits2).toEqual(hits1);
    });

    it('expires search cache after TTL (24 hours)', async () => {
      vi.useFakeTimers();
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      await searchTurath('صلاة', 5);
      expect(api.fetch).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(23 * 60 * 60 * 1000);
      await searchTurath('صلاة', 5);
      expect(api.fetch).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      await searchTurath('صلاة', 5);
      expect(api.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('readTurathPage', () => {
    it('calls /page?book_id=&pg= — never the /page/<id>/<pg> path form (404 on the live API)', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      await readTurathPage(String(FIXTURE_BOOK_ID), FIXTURE_PAGE_ID);
      expect(api.calls).toHaveLength(1);
      expect(api.calls[0].path).toBe('/page');
      expect(api.calls[0].params).toMatchObject({
        book_id: String(FIXTURE_BOOK_ID),
        pg: String(FIXTURE_PAGE_ID),
        ver: '3',
      });
    });

    it('reads and normalizes a real page', async () => {
      global.fetch = turathFetchFake().fetch as unknown as typeof fetch;

      const page = await readTurathPage('127708', 10);
      expect(page.bookId).toBe('127708');
      expect(page.pageNumber).toBe(10); // the sequential index it was asked for
      expect(page.printedPage).toBe(13);
      expect(page.volume).toBe(1);
      expect(page.pageLabel).toBe('ج1، ص13');
      expect(page.text).toContain('تحصل المبادلة بالقول');
      expect(page.text).not.toMatch(/<[^>]+>/);
    });

    it('a hit id round-trips: the pg sent to /page is the hit\'s page_id, not its printed page', async () => {
      // The chunk id the model sees is turath:<book>:<pageNumber>; when it
      // passes that to read_shamela_page the client must ask Turath for the
      // same sequential page. Sending the printed page (129) would fetch a
      // different page of the book.
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      const [hit] = await searchTurath('الربا', 5);
      expect(hit.pageNumber).not.toBe(hit.printedPage);

      await readTurathPage(hit.bookId, hit.pageNumber).catch(() => undefined);
      const pageCall = api.calls.find((c) => c.path === '/page');
      expect(pageCall?.params.pg).toBe(String(hit.pageNumber));
    });

    it('strips turath: prefix from bookId before fetching', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      const page = await readTurathPage('turath:127708', 10);
      expect(api.calls[0].params.book_id).toBe('127708');
      expect(page.bookId).toBe('127708');
    });

    it('reports a page that does not exist (Turath answers 200 with {})', async () => {
      global.fetch = turathFetchFake().fetch as unknown as typeof fetch;
      await expect(readTurathPage('127708', 999_999)).rejects.toThrow(/Turath page not found/);
    });

    it('throws validation error on invalid bookId or page number before network call', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;
      await expect(readTurathPage('', 1)).rejects.toThrow(/numeric/);
      await expect(readTurathPage('not-a-number', 1)).rejects.toThrow(/numeric/);
      await expect(readTurathPage('127708', 0)).rejects.toThrow(/Invalid page number/);
      await expect(readTurathPage('127708', -5)).rejects.toThrow(/Invalid page number/);
      await expect(readTurathPage('127708', Number.NaN)).rejects.toThrow(/Invalid page number/);
      expect(api.fetch).not.toHaveBeenCalled();
    });

    it('caches page content and does not re-fetch', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      const page1 = await readTurathPage('127708', 10);
      const page2 = await readTurathPage('127708', 10);
      expect(api.fetch).toHaveBeenCalledTimes(1);
      expect(page2).toEqual(page1);
    });
  });

  describe('findTurathBook', () => {
    it('resolves a numeric id via /book then /author (title, author name, hijri death year)', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      const books = await findTurathBook('127708');
      expect(api.calls.map((c) => c.path)).toEqual(['/book', '/author']);
      expect(api.calls[0].params).toMatchObject({ id: '127708', ver: '3' });
      expect(api.calls[1].params).toMatchObject({ id: '611', ver: '3' });

      expect(books).toHaveLength(1);
      expect(books[0]).toEqual({
        id: 127708,
        title: 'المطلع على دقائق زاد المستقنع «المعاملات المالية»',
        author: 'عبد الكريم اللاحم',
        deathYear: 1438, // "١٤٣٨" — Arabic-Indic digits
      });
    });

    it('strips turath: prefix from book lookup query', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;
      const books = await findTurathBook('turath:127708');
      expect(api.calls[0].params.id).toBe('127708');
      expect(books[0].id).toBe(127708);
    });

    it('still returns the book when the author lookup fails', async () => {
      const good = turathFetchFake();
      const authorDown = turathFetchFake({ forceStatus: 500 });
      global.fetch = vi.fn(async (input: unknown) =>
        new URL(String(input)).pathname === '/author' ? authorDown.fetch(input) : good.fetch(input),
      ) as unknown as typeof fetch;

      const books = await findTurathBook('127708');
      expect(books).toHaveLength(1);
      expect(books[0].author).toBeNull();
      expect(books[0].deathYear).toBeNull();
    });

    it('returns empty array immediately for empty query without network call', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;
      expect(await findTurathBook('')).toEqual([]);
      expect(await findTurathBook('   ')).toEqual([]);
      expect(api.fetch).not.toHaveBeenCalled();
    });

    it('returns [] for an unknown numeric id (the live API answers 404 {})', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;
      expect(await findTurathBook('99999999')).toEqual([]);
      expect(api.calls).toHaveLength(1);
    });

    it('does NOT swallow a server error on a numeric id lookup', async () => {
      global.fetch = turathFetchFake({ forceStatus: 500 }).fetch as unknown as typeof fetch;
      await expect(findTurathBook('127708')).rejects.toThrow(/HTTP 500/);
    });

    it('resolves a title query to the distinct books among the search hits', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      const books = await findTurathBook('زاد المستقنع', 10);
      expect(api.calls.map((c) => c.path)).toEqual(['/search']);
      expect(books.map((b) => b.id)).toEqual([127708, 14474, 16526, 832]);
      expect(books[0].author).toBe('عبد الكريم اللاحم');
      // Search hits have no death year, and one /author call per book would
      // multiply latency — null is the honest value.
      expect(books[0].deathYear).toBeNull();
    });
  });

  describe('2-tier persistence & LRU eviction', () => {
    it('persists cache to disk and restores it after memory is cleared', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      const hits = await searchTurath('طهارة', 10);
      expect(api.fetch).toHaveBeenCalledTimes(1);

      _flushTurathCache();
      expect(fs.existsSync(testCacheFile)).toBe(true);

      _reloadTurathCache(); // simulate an app restart

      const cachedHits = await searchTurath('طهارة', 10);
      expect(api.fetch).toHaveBeenCalledTimes(1);
      expect(cachedHits).toEqual(hits);
    });

    it('does not load expired disk cache entries', async () => {
      fs.writeFileSync(testCacheFile, JSON.stringify({
        version: 2,
        entries: { 'search:expired:8:': { data: [], expiresAt: Date.now() - 1000 } },
      }), 'utf8');
      _reloadTurathCache();

      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;
      await searchTurath('expired', 8);
      expect(api.fetch).toHaveBeenCalledTimes(1);
    });

    it('ignores a cache file from the old format (v1 was full of cached-empty search results)', async () => {
      // v1 files were written by a client whose parser found nothing in the
      // real envelope, so they hold `[]` for searches that DO have results —
      // valid for another 24h. Serving them would keep search broken after the fix.
      fs.writeFileSync(testCacheFile, JSON.stringify({
        version: 1,
        entries: { 'search:الربا:8:': { data: [], expiresAt: Date.now() + 60_000 } },
      }), 'utf8');
      _reloadTurathCache();

      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;
      const hits = await searchTurath('الربا', 8);
      expect(api.fetch).toHaveBeenCalledTimes(1);
      expect(hits.length).toBeGreaterThan(0);
    });

    it('handles corrupted JSON in cache file gracefully without throwing', () => {
      fs.writeFileSync(testCacheFile, 'NOT_VALID_JSON{[[[', 'utf8');
      expect(() => _reloadTurathCache()).not.toThrow();
    });

    it('evicts oldest entries when LRU capacity limit is exceeded', async () => {
      const api = turathFetchFake();
      global.fetch = api.fetch as unknown as typeof fetch;

      for (let i = 0; i <= TURATH_MAX_CACHE_ENTRIES; i++) {
        await searchTurath(`term_${i}`, 5);
      }
      expect(api.fetch).toHaveBeenCalledTimes(TURATH_MAX_CACHE_ENTRIES + 1);

      await searchTurath(`term_${TURATH_MAX_CACHE_ENTRIES}`, 5); // newest: cached
      expect(api.fetch).toHaveBeenCalledTimes(TURATH_MAX_CACHE_ENTRIES + 1);

      await searchTurath('term_0', 5); // oldest: evicted
      expect(api.fetch).toHaveBeenCalledTimes(TURATH_MAX_CACHE_ENTRIES + 2);
    });
  });

  describe('errors & caching invariant', () => {
    it('NEVER caches errors on network failure', async () => {
      const good = turathFetchFake();
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockImplementation(good.fetch) as unknown as typeof fetch;

      await expect(searchTurath('طهارة', 5)).rejects.toThrow('Network error');

      const hits = await searchTurath('طهارة', 5);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(hits).toHaveLength(4);
    });

    it('NEVER caches 500 responses', async () => {
      const bad = turathFetchFake({ forceStatus: 500 });
      const good = turathFetchFake();
      // first request + its one retry both fail; the next call must go to the network again
      global.fetch = vi
        .fn()
        .mockImplementationOnce(bad.fetch)
        .mockImplementationOnce(bad.fetch)
        .mockImplementation(good.fetch) as unknown as typeof fetch;

      await expect(readTurathPage('127708', 10)).rejects.toThrow(/HTTP 500/);

      const page = await readTurathPage('127708', 10);
      expect(page.bookId).toBe('127708');
    });
  });

  describe('resilience & 429 backoff', () => {
    it('retries on HTTP 429 respecting Retry-After header and succeeds on retry', async () => {
      const limited = turathFetchFake({ forceStatus: 429, forceHeaders: { 'Retry-After': '0.05' } });
      const good = turathFetchFake();
      global.fetch = vi
        .fn()
        .mockImplementationOnce(limited.fetch)
        .mockImplementation(good.fetch) as unknown as typeof fetch;

      const hits = await searchTurath('استدلال', 5);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(hits).toHaveLength(4);
    });

    it('retries on HTTP 503 and fails if retry also fails', async () => {
      const down = turathFetchFake({ forceStatus: 503 });
      global.fetch = down.fetch as unknown as typeof fetch;

      await expect(searchTurath('استدلال', 5)).rejects.toThrow(/HTTP 503/);
      expect(down.fetch).toHaveBeenCalledTimes(2);
    });

    it('configures 12-second request timeout and passes abort signal to fetch', async () => {
      expect(TURATH_REQUEST_TIMEOUT_MS).toBe(12_000);

      const good = turathFetchFake();
      global.fetch = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
        expect(init?.signal).toBeDefined();
        expect(init?.signal?.aborted).toBe(false);
        return good.fetch(input);
      }) as unknown as typeof fetch;

      await searchTurath('طهارة', 5);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrency limiter', () => {
    it('bounds concurrent requests to max 2', async () => {
      let active = 0;
      let maxActive = 0;
      const good = turathFetchFake();

      global.fetch = vi.fn().mockImplementation(async (input: unknown) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return good.fetch(input);
      }) as unknown as typeof fetch;

      await Promise.all([
        searchTurath('q1', 5),
        searchTurath('q2', 5),
        searchTurath('q3', 5),
        searchTurath('q4', 5),
      ]);

      expect(maxActive).toBeLessThanOrEqual(2);
    });
  });

  describe('the fake itself is faithful (guards the guard)', () => {
    it('404s on the path forms an earlier client wrongly called', async () => {
      const api = turathFetchFake();
      const page = await api.fetch('https://api.turath.io/page/127708/10');
      const book = await api.fetch('https://api.turath.io/book/127708');
      expect(page.status).toBe(404);
      expect(book.status).toBe(404);
    });
  });
});
