// @vitest-environment node
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import searchFixture from './fixtures/turath/search.json';
import pageFixture from './fixtures/turath/page.json';
import bookFixture from './fixtures/turath/book.json';
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
    it('fetches and normalizes search results using search fixture', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => searchFixture,
      } as unknown as Response);

      const hits = await searchTurath('طهارة', 10);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(hits).toHaveLength(3);

      const first = hits[0];
      expect(first.bookId).toBe('2166');
      expect(first.bookTitle).toBe('المبسوط');
      expect(first.author).toBe('السرخسي');
      expect(first.pageNumber).toBe(12);
      expect(first.snippet).not.toContain('<em>');
      expect(first.snippet).toContain('يا أيها الذين آمنوا');
      expect(first.score).toBe(1);
      expect(first.id).toBe('turath:2166:12');
    });

    it('sends proper User-Agent and Accept headers', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => searchFixture,
      } as unknown as Response);

      await searchTurath('طهارة', 5);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/search?q=%D8%B7%D9%87%D8%A7%D8%B1%D8%A9'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': TURATH_USER_AGENT,
            Accept: 'application/json',
          }),
        }),
      );
    });

    it('returns empty array immediately for empty or whitespace query without network call', async () => {
      global.fetch = vi.fn();
      expect(await searchTurath('')).toEqual([]);
      expect(await searchTurath('   ')).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('filters results by scoped bookIds and enforces limit', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => searchFixture,
      } as unknown as Response);

      const hits = await searchTurath('طهارة', 1, [2166]);
      expect(hits).toHaveLength(1);
      expect(hits[0].bookId).toBe('2166');
    });

    it('caches search results and returns cached hits on repeated query', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => searchFixture,
      } as unknown as Response);

      const hits1 = await searchTurath('صلاة', 5);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(hits1).toHaveLength(3);

      // Second call should hit memory cache
      const hits2 = await searchTurath('صلاة', 5);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(hits2).toEqual(hits1);
    });

    it('expires search cache after TTL (24 hours)', async () => {
      vi.useFakeTimers();
      try {
        global.fetch = vi.fn().mockImplementation(async () => ({
          ok: true,
          status: 200,
          json: async () => searchFixture,
        } as unknown as Response));

        await searchTurath('صلاة', 5);
        expect(global.fetch).toHaveBeenCalledTimes(1);

        // Advance time 23 hours -> still in cache
        vi.advanceTimersByTime(23 * 60 * 60 * 1000);
        await searchTurath('صلاة', 5);
        expect(global.fetch).toHaveBeenCalledTimes(1);

        // Advance past 24 hours -> expired, re-fetches
        vi.advanceTimersByTime(2 * 60 * 60 * 1000);
        await searchTurath('صلاة', 5);
        expect(global.fetch).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('readTurathPage', () => {
    it('reads and normalizes a page using page fixture', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => pageFixture,
      } as unknown as Response);

      const page = await readTurathPage('2166', 12);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(page.bookId).toBe('2166');
      expect(page.pageNumber).toBe(12);
      expect(page.text).toContain('الطهور شطر الإيمان');
      expect(page.volume).toBe(1);
      expect(page.headings).toEqual(['كتاب الطهارة', 'باب الوضوء']);
    });

    it('strips turath: prefix from bookId before fetching', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => pageFixture,
      } as unknown as Response);

      const page = await readTurathPage('turath:2166', 12);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/page\/2166\/12$/),
        expect.anything(),
      );
      expect(page.bookId).toBe('2166');
    });

    it('throws validation error on invalid bookId or page number before network call', async () => {
      global.fetch = vi.fn();
      await expect(readTurathPage('', 1)).rejects.toThrow(/Turath bookId is required/);
      await expect(readTurathPage('2166', 0)).rejects.toThrow(/Invalid page number/);
      await expect(readTurathPage('2166', -5)).rejects.toThrow(/Invalid page number/);
      await expect(readTurathPage('2166', Number.NaN)).rejects.toThrow(/Invalid page number/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('caches page content with 7-day TTL and does not re-fetch', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => pageFixture,
      } as unknown as Response);

      const page1 = await readTurathPage('2166', 12);
      const page2 = await readTurathPage('2166', 12);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(page2).toEqual(page1);
    });
  });

  describe('findTurathBook', () => {
    it('returns book metadata from direct /book/:id fixture', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => bookFixture,
      } as unknown as Response);

      const books = await findTurathBook('2166');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(books).toHaveLength(1);
      expect(books[0]).toEqual({
        id: 2166,
        title: 'المبسوط',
        author: 'محمد بن أحمد بن أبي سهل السرخسي',
        deathYear: 483,
      });
    });

    it('strips turath: prefix from book lookup query', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => bookFixture,
      } as unknown as Response);

      const books = await findTurathBook('turath:2166');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/book\/2166$/),
        expect.anything(),
      );
      expect(books[0].id).toBe(2166);
    });

    it('returns empty array immediately for empty query without network call', async () => {
      global.fetch = vi.fn();
      expect(await findTurathBook('')).toEqual([]);
      expect(await findTurathBook('   ')).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns empty array when numeric /book/:id returns 404 (book not found)', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as unknown as Response);

      const books = await findTurathBook('99999');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(books).toEqual([]);
    });

    it('falls back to search hits when /book returns 404 for text title query', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => searchFixture,
        } as unknown as Response);

      const books = await findTurathBook('المبسوط', 10);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(books.length).toBeGreaterThanOrEqual(1);
      expect(books[0].id).toBe(2166);
      expect(books[0].title).toBe('المبسوط');
    });
  });

  describe('2-tier persistence & LRU eviction', () => {
    it('persists cache to disk and restores it after memory is cleared', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => searchFixture,
      } as unknown as Response);

      // Perform initial search
      const hits = await searchTurath('طهارة', 10);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Flush in-memory cache to disk
      _flushTurathCache();
      expect(fs.existsSync(testCacheFile)).toBe(true);

      // Simulate app restart / clear memory
      _reloadTurathCache();

      // Next call should load from disk cache without invoking fetch
      const cachedHits = await searchTurath('طهارة', 10);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(cachedHits).toEqual(hits);
    });

    it('does not load expired disk cache entries', async () => {
      const expiredData = {
        version: 1,
        entries: {
          'search:expired:8:': {
            data: [{ id: 'turath:1:1', bookId: '1', bookTitle: 'قديم', pageNumber: 1, volume: 1, snippet: '', content: '', score: 1, headings: [] }],
            expiresAt: Date.now() - 1000,
          },
        },
      };
      fs.writeFileSync(testCacheFile, JSON.stringify(expiredData), 'utf8');

      _reloadTurathCache();
      // Should not contain expired entry
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => searchFixture,
      } as unknown as Response);

      await searchTurath('expired', 8);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('handles corrupted JSON in cache file gracefully without throwing', () => {
      fs.writeFileSync(testCacheFile, 'NOT_VALID_JSON{[[[', 'utf8');
      expect(() => _reloadTurathCache()).not.toThrow();
    });

    it('evicts oldest entries when LRU capacity limit is exceeded', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url);
        const q = u.searchParams.get('q') || 'q';
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              book_id: 1,
              meta: JSON.stringify({ book_name: q, author_name: 'test', page: 1, vol: 1 }),
              text: `result for ${q}`,
            },
          ],
        } as unknown as Response;
      });

      // Fill up to TURATH_MAX_CACHE_ENTRIES + 1
      for (let i = 0; i <= TURATH_MAX_CACHE_ENTRIES; i++) {
        await searchTurath(`term_${i}`, 5);
      }

      // Fetch calls should have been made for all items
      expect(global.fetch).toHaveBeenCalledTimes(TURATH_MAX_CACHE_ENTRIES + 1);

      // The most recent term should be in cache
      await searchTurath(`term_${TURATH_MAX_CACHE_ENTRIES}`, 5);
      expect(global.fetch).toHaveBeenCalledTimes(TURATH_MAX_CACHE_ENTRIES + 1);

      // term_0 (the oldest) should have been evicted and will trigger a new fetch
      await searchTurath('term_0', 5);
      expect(global.fetch).toHaveBeenCalledTimes(TURATH_MAX_CACHE_ENTRIES + 2);
    });
  });

  describe('errors & caching invariant', () => {
    it('NEVER caches errors on network failure', async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => searchFixture,
        } as unknown as Response);

      await expect(searchTurath('طهارة', 5)).rejects.toThrow('Network error');

      // Subsequent call must retry and succeed, not return cached failure
      const hits = await searchTurath('طهارة', 5);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(hits).toHaveLength(3);
    });

    it('NEVER caches 404 or 500 error responses', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers(),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers(),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => pageFixture,
        } as unknown as Response);

      await expect(readTurathPage('9999', 1)).rejects.toThrow(/HTTP 500/);

      const page = await readTurathPage('9999', 1);
      expect(page.bookId).toBe('9999');
    });
  });

  describe('resilience & 429 backoff', () => {
    it('retries on HTTP 429 respecting Retry-After header and succeeds on retry', async () => {
      const headers = new Headers();
      headers.set('Retry-After', '0.05'); // 50ms

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers,
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => searchFixture,
        } as unknown as Response);

      const hits = await searchTurath('استدلال', 5);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(hits).toHaveLength(3);
    });

    it('retries on HTTP 503 and fails if retry also fails', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers(),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers(),
        } as unknown as Response);

      await expect(searchTurath('استدلال', 5)).rejects.toThrow(/HTTP 503/);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('configures 12-second request timeout and passes abort signal to fetch', async () => {
      expect(TURATH_REQUEST_TIMEOUT_MS).toBe(12_000);

      global.fetch = vi.fn().mockImplementation((_url, init) => {
        expect(init?.signal).toBeDefined();
        expect(init?.signal?.aborted).toBe(false);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => searchFixture,
        } as unknown as Response);
      });

      await searchTurath('طهارة', 5);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrency limiter', () => {
    it('bounds concurrent requests to max 2', async () => {
      let active = 0;
      let maxActive = 0;

      global.fetch = vi.fn().mockImplementation(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return {
          ok: true,
          status: 200,
          json: async () => searchFixture,
        } as unknown as Response;
      });

      await Promise.all([
        searchTurath('q1', 5),
        searchTurath('q2', 5),
        searchTurath('q3', 5),
        searchTurath('q4', 5),
      ]);

      expect(maxActive).toBeLessThanOrEqual(2);
    });
  });
});
