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

      expect(results).toHaveLength(3);

      const first = results[0];
      expect(first.domain).toBe('turath');
      expect(first.language).toBe('ar');
      expect(first.has_matn).toBe(true);
      expect(first.content).toContain('والأصل في ذلك قوله تعالى');

      // Citation coordinates
      expect(first.citation_ref.book).toBe('المبسوط');
      expect(first.citation_ref.author).toBe('السرخسي');
      expect(first.citation_ref.book_id).toBe('2166');
      expect(first.citation_ref.page).toBe(12);
      expect(first.citation_ref.volume).toBe(1);
      expect(first.citation_ref.url).toBe('https://turath.io/book/2166?page=12');
      expect(first.citation_ref.headings).toEqual(['كتاب الطهارة', 'باب الوضوء']);
      expect(first.citation_ref.discipline).toBe('fiqh');
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

      const results = await searchTurathCloud('الوضوء', { bookIds: [512] });
      expect(results).toHaveLength(1);
      expect(results[0].citation_ref.book_id).toBe('512');
      expect(results[0].citation_ref.book).toBe('جامع البيان عن تأويل آي القرآن');
      expect(results[0].citation_ref.discipline).toBe('tafsir');
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
          url: 'https://turath.io/book/2166?page=12',
          discipline: 'fiqh',
        },
        language: 'ar',
        has_matn: true,
      };

      // Both should yield the same classical identity
      expect(resultIdentity(tierDResult)).toBe('classical:2166:12');
      expect(resultIdentity(tierTResult)).toBe('classical:2166:12');

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
        citation_ref: { book_id: '2166', page: 12 },
        language: 'ar',
      };
      const page13: IslamicResult = {
        domain: 'turath',
        content: 'صفحة 13',
        citation_ref: { book_id: '2166', page: 13 },
        language: 'ar',
      };
      const book3410: IslamicResult = {
        domain: 'classical-rijal',
        content: 'كتاب آخر',
        citation_ref: { book_id: '3410', page: 12 },
        language: 'ar',
      };

      const deduped = dedupeResults([page12, page13, book3410]);
      expect(deduped).toHaveLength(3);
    });
  });
});
