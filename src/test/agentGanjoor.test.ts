// @vitest-environment node
// shared/research/ganjoor.ts + electron/agent/adapters/ganjoor.ts (ADR-0042).
// api.ganjoor.net/poems/search returns an ARRAY of poem objects; the adapter
// runs in-process like repositories.ts and degrades (never throws) on failure.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normaliseGanjoor, findPoetId } from '../../shared/research/ganjoor';
import { searchPersianPoetry } from '../../electron/agent/adapters/ganjoor';

const POEM = {
  id: 2130,
  title: 'غزل شمارهٔ ۱',
  fullUrl: '/hafez/ghazal/sh1',
  verses: [
    { vOrder: 2, text: 'که عشق آسان نمود اول ولی افتاد مشکل‌ها' },
    { vOrder: 1, text: 'الا یا ایها الساقی ادر کاسا و ناولها' },
  ],
  category: { poet: { name: 'حافظ', nickname: 'حافظ شیرازی' }, cat: { title: 'غزلیات', bookName: 'دیوان حافظ' } },
};

describe('normaliseGanjoor', () => {
  it('builds a citable chunk with poet, work, ordered verses and a ganjoor.net link', () => {
    const [c] = normaliseGanjoor([POEM], 6);
    expect(c.id).toBe('ganjoor:2130');
    expect(c.reference).toMatch(/حافظ شیرازی — دیوان حافظ/);
    expect(c.reference).toMatch(/\(گنجور \/ Ganjoor\)$/);
    expect((c.content ?? '').startsWith('الا یا ایها الساقی')).toBe(true); // vOrder sorted
    expect(c.source_url).toBe('https://ganjoor.net/hafez/ghazal/sh1');
  });

  it('falls back to plainText when verses are absent, and drops a poem with neither', () => {
    expect(normaliseGanjoor([{ id: 1, plainText: 'یک بیت', category: {} }], 6)[0].content).toBe('یک بیت');
    expect(normaliseGanjoor([{ id: 2, category: {} }], 6)).toHaveLength(0);
  });

  it('a non-array response yields nothing', () => {
    expect(normaliseGanjoor({ error: 'x' }, 6)).toEqual([]);
  });
});

describe('findPoetId', () => {
  it('matches on name or nickname, case-insensitively', () => {
    const poets = [{ id: 2, name: 'حافظ', nickname: 'خواجه شیراز' }, { id: 5, name: 'مولوی', nickname: 'رومی' }];
    expect(findPoetId(poets, 'رومی')).toBe(5);
    expect(findPoetId(poets, 'حافظ')).toBe(2);
    expect(findPoetId(poets, 'nobody')).toBe(0);
  });
});

function mockFetch(json: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(json), { status }));
}

beforeEach(() => vi.restoreAllMocks());

describe('searchPersianPoetry', () => {
  it('returns citable chunks from a search hit', async () => {
    mockFetch([POEM]);
    const r = await searchPersianPoetry({ query: 'ساقی' });
    expect(r.error).toBeUndefined();
    expect(r.chunks).toHaveLength(1);
    expect(r.chunks[0].id).toBe('ganjoor:2130');
  });

  it('an empty query is an error, not a request', async () => {
    const f = mockFetch([]);
    const r = await searchPersianPoetry({ query: '  ' });
    expect(r.error).toMatch(/search phrase/);
    expect(f).not.toHaveBeenCalled();
  });

  it('an HTTP error is returned, not thrown', async () => {
    mockFetch({}, 500);
    const r = await searchPersianPoetry({ query: 'دل' });
    expect(r.chunks).toEqual([]);
    expect(r.error).toContain('500');
  });

  it('a network throw is returned, not thrown', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const r = await searchPersianPoetry({ query: 'دل' });
    expect(r.error).toMatch(/lookup failed/);
  });

  it('no results → a note, not an error', async () => {
    mockFetch([]);
    const r = await searchPersianPoetry({ query: 'zzz' });
    expect(r.error).toBeUndefined();
    expect(r.note).toBeTruthy();
  });
});
