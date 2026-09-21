// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  searchTurathCloud,
  detectTurathDiscipline,
  clearTurathCloudCache,
  isTurathEnabled,
  type IslamicResult,
} from '../../supabase/functions/_shared/turath';
import { dedupeResults, resultIdentity } from '../../supabase/functions/_shared/resultIdentity';
import searchFixture from './fixtures/turath/search.json';

describe('turathCloudTier (Phase 1e)', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.TURATH_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    clearTurathCloudCache();
    delete process.env.TURATH_ENABLED;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv !== undefined) {
      process.env.TURATH_ENABLED = originalEnv;
    } else {
      delete process.env.TURATH_ENABLED;
    }
  });

  describe('searchTurathCloud mapping', () => {
    it('fetches api.turath.io and maps results conforming to IslamicResult contract', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => searchFixture,
      });

      const results = await searchTurathCloud('الوضوء', { limit: 5 });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.turath.io/search?q=%D8%A7%D9%84%D9%88%D8%B6%D9%88%D8%A1&ver=3'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'User-Agent': 'EasyEditor-CloudTierT/1.0',
            Accept: 'application/json',
          }),
        }),
      );

      // Regression: the live envelope is {count, data:[…]}. Tier T only looked
      // for a bare array / .results, so against the real API it returned [] for
      // EVERY query — the tier was silently dead in production.
      expect(results).toHaveLength(4);

      const first = results[0];
      expect(first.domain).toBe('turath');
      expect(first.language).toBe('ar');
      expect(first.has_matn).toBe(true);
      expect(first.content).toContain('المبحث الرابع من يجري بينهم الربا');
      expect(first.content).not.toMatch(/<[^>]+>/);

      // Citation coordinates
      expect(first.citation_ref.book).toContain('زاد المستقنع');
      expect(first.citation_ref.author).toBe('عبد الكريم اللاحم');
      expect(first.citation_ref.book_id).toBe('127708');
      expect(first.citation_ref.page).toBe(129);   // printed page
      expect(first.citation_ref.volume).toBe(2);
      expect(first.citation_ref.page_id).toBe(724); // sequential index
      expect(first.citation_ref.headings).toHaveLength(3);
    });

    it('links to the reader at app.turath.io using page_id (turath.io/book/… 302s to the app root)', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => searchFixture });
      const [first] = await searchTurathCloud('الربا', { limit: 5 });
      expect(first.citation_ref.url).toBe('https://app.turath.io/book/127708?page=724');
      // printed page 129 must NOT be used as the address
      expect(first.citation_ref.url).not.toContain('page=129');
    });

    it('respects the limit option', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => searchFixture,
      });

      const results = await searchTurathCloud('الوضوء', { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('filters results by bookIds when provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => searchFixture,
      });

      const results = await searchTurathCloud('الوضوء', { bookIds: [832] });
      expect(results).toHaveLength(1);
      expect(results[0].citation_ref.book_id).toBe('832');
    });

    it('returns empty array for empty or whitespace query without network call', async () => {
      global.fetch = vi.fn();
      const results = await searchTurathCloud('   ');
      expect(results).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('handles HTTP error gracefully without throwing', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      const results = await searchTurathCloud('استدلال');
      expect(results).toEqual([]);
    });

    it('re-throws when signal was explicitly aborted (timeout handling)', async () => {
      const controller = new AbortController();
      controller.abort();

      global.fetch = vi.fn().mockImplementation((_url, init) => {
        if (init?.signal?.aborted) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          return Promise.reject(err);
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      await expect(searchTurathCloud('بطيء', { signal: controller.signal })).rejects.toThrow(/aborted/);
    });
  });

  describe('detectTurathDiscipline', () => {
    it('detects fiqh works correctly', () => {
      expect(detectTurathDiscipline('المبسوط للسرخسي', 'فقه حنفي')).toBe('fiqh');
      expect(detectTurathDiscipline('رد المحتار على الدر المختار')).toBe('fiqh');
      expect(detectTurathDiscipline('المغني', '', ['كتاب الصلاة'])).toBe('fiqh');
      expect(detectTurathDiscipline('روضة الطالبين وعمدة المفتين')).toBe('fiqh');
    });

    it('detects tafsir works correctly', () => {
      expect(detectTurathDiscipline('جامع البيان عن تأويل آي القرآن')).toBe('tafsir');
      expect(detectTurathDiscipline('تفسير القرآن العظيم', '', ['سورة الفاتحة'])).toBe('tafsir');
      expect(detectTurathDiscipline('الكشاف عن حقائق غوامض التنزيل')).toBe('tafsir');
    });

    it('detects nahw / grammar / lexicon works correctly', () => {
      expect(detectTurathDiscipline('شرح قطر الندى وبل الصدى')).toBe('nahw');
      expect(detectTurathDiscipline('الألفية لابن مالك')).toBe('nahw');
      expect(detectTurathDiscipline('لسان العرب')).toBe('nahw');
      expect(detectTurathDiscipline('الصحاح تاج اللغة')).toBe('nahw');
    });

    it('detects rijal / biographical works correctly', () => {
      expect(detectTurathDiscipline('تهذيب الكمال في أسماء الرجال')).toBe('rijal');
      expect(detectTurathDiscipline('سير أعلام النبلاء')).toBe('rijal');
      expect(detectTurathDiscipline('الجرح والتعديل لابن أبي حاتم')).toBe('rijal');
    });

    it('defaults to classical for uncategorized titles', () => {
      expect(detectTurathDiscipline('مقدمة ابن خلدون')).toBe('classical');
      expect(detectTurathDiscipline('رسائل الجاحظ')).toBe('classical');
    });
  });

  describe('kill switch TURATH_ENABLED', () => {
    it('defaults to true when unset', () => {
      expect(isTurathEnabled()).toBe(true);
    });

    it('returns empty results immediately when TURATH_ENABLED is false', async () => {
      process.env.TURATH_ENABLED = 'false';
      expect(isTurathEnabled()).toBe(false);

      global.fetch = vi.fn();
      const results = await searchTurathCloud('فقه');
      expect(results).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns empty results when TURATH_ENABLED is off or 0', async () => {
      process.env.TURATH_ENABLED = 'off';
      expect(isTurathEnabled()).toBe(false);

      process.env.TURATH_ENABLED = '0';
      expect(isTurathEnabled()).toBe(false);
    });
  });

  describe('caching architecture', () => {
    it('uses L1 in-memory cache for repeated calls', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => searchFixture,
      });

      const res1 = await searchTurathCloud('الوضوء', { limit: 5 });
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const res2 = await searchTurathCloud('الوضوء', { limit: 5 });
      expect(global.fetch).toHaveBeenCalledTimes(1); // from L1 memory
      expect(res2).toEqual(res1);
    });

    it('checks and updates Supabase api_response_cache table when client provided', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }),
      });
      const mockUpsert = vi.fn().mockResolvedValue({ error: null });

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'api_response_cache') {
            return {
              select: mockSelect,
              upsert: mockUpsert,
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => searchFixture,
      });

      const results = await searchTurathCloud('الوضوء', { limit: 3, supabase: mockSupabase });
      expect(results).toHaveLength(3);
      // the key is versioned, so rows written under an older row shape are never served
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ cache_key: expect.stringContaining('turath:v2:search:') }),
        expect.anything(),
      );
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'turath',
          response: results,
        }),
        expect.objectContaining({ onConflict: 'cache_key' }),
      );
    });
  });

  describe('deduplication with Tier D via resultIdentity & dedupeResults', () => {
    it('collapses identical classical passages from Tier D and Tier T into one', () => {
      // Tier D: pre-ingested classical passage from pgvector with no external URL
      const tierDResult: IslamicResult = {
        domain: 'classical-rijal',
        content: 'نص السرخسي في المبسوط من قاعدة البيانات',
        citation_ref: {
          book: 'المبسوط',
          author: 'السرخسي',
          book_id: 2166,
          page: 12,
          volume: 1,
          discipline: 'fiqh',
        },
        language: 'ar',
        has_matn: true,
      };

      // Tier T: live Turath API hit with generated turath.io URL
      const tierTResult: IslamicResult = {
        domain: 'turath',
        content: 'نص السرخسي من واجهة تراث',
        citation_ref: {
          book: 'المبسوط',
          author: 'السرخسي',
          book_id: '2166',
          page: 12,
          volume: 1,
          url: 'https://app.turath.io/book/2166?page=10452',
          discipline: 'fiqh',
        },
        language: 'ar',
        has_matn: true,
      };

      // Both should yield the same classical identity
      expect(resultIdentity(tierDResult)).toBe('classical:2166:v1:p12');
      expect(resultIdentity(tierTResult)).toBe('classical:2166:v1:p12');

      // Deduplication preserves the first occurrence (Tier D wins if first)
      const deduped1 = dedupeResults([tierDResult, tierTResult]);
      expect(deduped1).toHaveLength(1);
      expect(deduped1[0]).toBe(tierDResult);

      // Deduplication preserves the first occurrence (Tier T wins if first)
      const deduped2 = dedupeResults([tierTResult, tierDResult]);
      expect(deduped2).toHaveLength(1);
      expect(deduped2[0]).toBe(tierTResult);
    });

    it('keeps distinct passages distinct', () => {
      const page12: IslamicResult = {
        domain: 'turath',
        content: 'صفحة 12',
        citation_ref: { book_id: '2166', volume: 1, page: 12 },
        language: 'ar',
      };
      const page13: IslamicResult = {
        domain: 'turath',
        content: 'صفحة 13',
        citation_ref: { book_id: '2166', volume: 1, page: 13 },
        language: 'ar',
      };
      const book3410: IslamicResult = {
        domain: 'classical-rijal',
        content: 'كتاب آخر',
        citation_ref: { book_id: '3410', volume: 1, page: 12 },
        language: 'ar',
      };
      // Regression: same book, same printed page number, DIFFERENT volume.
      // Printed pages restart per volume; these are two passages, not a duplicate.
      const vol9page12: IslamicResult = {
        domain: 'turath',
        content: 'المجلد التاسع صفحة 12',
        citation_ref: { book_id: '2166', volume: 9, page: 12 },
        language: 'ar',
      };

      const deduped = dedupeResults([page12, page13, book3410, vol9page12]);
      expect(deduped).toHaveLength(4);
    });
  });
});

// ─── Tier T trigger gate ────────────────────────────────────────────────────
import { shouldQueryTurath, TURATH_DISCIPLINES } from '../../supabase/functions/_shared/turath';
import { DISCIPLINE_SLUGS } from '../../supabase/functions/_shared/disciplines';

describe('shouldQueryTurath (Tier T trigger)', () => {
  it('REGRESSION: every trigger discipline is one the planner can actually emit', () => {
    // The gate once listed "seerah" — not a Discipline slug — so that branch was
    // dead code: no query could ever match it, and the prompt it was written for
    // (seerat_alam) never reached Turath. Cross-checking against the real slug
    // list makes that class of typo fail here instead of silently in production.
    for (const d of TURATH_DISCIPLINES) {
      expect(DISCIPLINE_SLUGS as readonly string[]).toContain(d);
    }
    expect(TURATH_DISCIPLINES as readonly string[]).not.toContain('seerah');
  });

  it('fires for each discipline where Turath adds coverage the local corpus lacks', () => {
    for (const d of ['fiqh', 'fatwa', 'lughat', 'nahw']) {
      expect(shouldQueryTurath([d], undefined)).toBe(true);
    }
  });

  it('does NOT fire implicitly for tafsir or rijal, where the local corpus is real and Turath is noisy', () => {
    // Live probe: "تفسير آية الكرسي" -> manuscript catalogues; "ترجمة سفيان الثوري"
    // -> Tuhfat al-Ashraf hadith entries. Rank fusion cannot tell that from a
    // good hit, so firing here would displace the 6,208 tafsir / 19,616 rijal
    // rows the local tiers already return.
    expect(shouldQueryTurath(['tafsir'], undefined)).toBe(false);
    expect(shouldQueryTurath(['rijal'], undefined)).toBe(false);
    // ...but a user who asks for Turath by name still gets it:
    expect(shouldQueryTurath(['tafsir'], ['turath'])).toBe(true);
    expect(shouldQueryTurath(['rijal'], ['turath'])).toBe(true);
  });

  it('fires when the user explicitly picks the turath domain, even with no discipline', () => {
    expect(shouldQueryTurath([], ['turath'])).toBe(true);
    expect(shouldQueryTurath([], ['dorar', 'turath'])).toBe(true);
  });

  it('does not fire for a plain Quran/hadith question', () => {
    expect(shouldQueryTurath([], undefined)).toBe(false);
    expect(shouldQueryTurath([], ['dorar', 'alquran'])).toBe(false);
  });

  it('does not fire for hadith_term (covered by the local classical corpus)', () => {
    expect(shouldQueryTurath(['hadith_term'], undefined)).toBe(false);
  });

  it('ignores a non-array selectedDomains instead of throwing', () => {
    expect(shouldQueryTurath([], 'turath')).toBe(false);
    expect(shouldQueryTurath([], null)).toBe(false);
  });
});
