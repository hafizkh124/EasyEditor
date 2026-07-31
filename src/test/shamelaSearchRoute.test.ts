import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchLocalShamela } from '../lib/shamela/localShamelaService';

/**
 * SPEC-M5 NFR-12 / SPEC-M5.9 FR-3: on desktop, Shamela lookups must reach
 * Shamela's own Lucene index through the main process — never the
 * tools/shamela-bridge HTTP sidecar. Deleting that folder has to leave the
 * desktop build fully working, which is the milestone's headline promise.
 *
 * The folder itself stays in the repo for the web build (SPEC-M5 §258), so
 * "no dependency" is asserted here rather than by removing it.
 */

const win = window as unknown as Record<string, unknown>;

function mockDesktop(search: ReturnType<typeof vi.fn>) {
  win.electronAPI = { isDesktop: true, shamela: { search } };
}

describe('searchLocalShamela — desktop route', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error('no HTTP allowed on desktop')));
    vi.stubGlobal('fetch', fetchSpy);
    localStorage.setItem('shamela.connected', '1');
  });

  afterEach(() => {
    delete win.electronAPI;
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('never issues an HTTP request', async () => {
    mockDesktop(vi.fn().mockResolvedValue([]));
    await searchLocalShamela('نية');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queries the native index with the caller’s query and limit', async () => {
    const search = vi.fn().mockResolvedValue([]);
    mockDesktop(search);
    await searchLocalShamela('إنما الأعمال', 7);
    expect(search).toHaveBeenCalledWith('إنما الأعمال', 7);
  });

  it('maps a native hit onto a citable ResourceResult', async () => {
    mockDesktop(vi.fn().mockResolvedValue([
      { bookId: '42', bookTitle: 'صحيح البخاري', pageNumber: 15, snippet: 'إنما الأعمال بالنيات', score: 1 },
    ]));

    const [hit] = await searchLocalShamela('نية');

    expect(hit.content).toBe('إنما الأعمال بالنيات');
    expect(hit.citation_ref.book).toBe('صحيح البخاري');
    expect(hit.citation_ref.page).toBe(15);
    // No invented URL — the citation points at a book on this machine.
    expect(hit.citation_ref.url).toBeUndefined();
    expect(hit.source_url).toBeUndefined();
  });

  it('tags results so the Shamela filter chip can find them', async () => {
    mockDesktop(vi.fn().mockResolvedValue([
      { bookId: '9', bookTitle: 'سنن أبي داود', pageNumber: 3, snippet: 'متن', score: 1 },
    ]));

    const [hit] = await searchLocalShamela('متن');

    expect(hit.match_key?.startsWith('shamela-')).toBe(true);
    expect(hit.reason).toContain('مکتبہ شاملہ');
  });

  it('strips markup and collapses whitespace out of snippets', async () => {
    mockDesktop(vi.fn().mockResolvedValue([
      { bookId: '1', bookTitle: 'كتاب', pageNumber: 1, snippet: '<b>إنما</b>   الأعمال\n\nبالنيات', score: 1 },
    ]));

    const [hit] = await searchLocalShamela('نية');
    expect(hit.content).toBe('إنما الأعمال بالنيات');
  });

  it('propagates the native diagnostic instead of returning nothing', async () => {
    // Risk R15: "no results" would hide a fixable install problem.
    mockDesktop(vi.fn().mockRejectedValue(new Error('شاملہ کی Java Runtime (JRE) نہیں ملی۔')));

    await expect(searchLocalShamela('نية')).rejects.toThrow(/Java Runtime/);
  });

  it('gives every hit a distinct match_key', async () => {
    mockDesktop(vi.fn().mockResolvedValue([
      { bookId: '1', bookTitle: 'كتاب', pageNumber: 5, snippet: 'أ', score: 1 },
      { bookId: '1', bookTitle: 'كتاب', pageNumber: 5, snippet: 'ب', score: 1 },
    ]));

    const hits = await searchLocalShamela('نية');
    expect(new Set(hits.map((h) => h.match_key)).size).toBe(2);
  });
});

describe('searchLocalShamela — web route is untouched', () => {
  beforeEach(() => {
    delete win.electronAPI;
    localStorage.setItem('shamela.connected', '1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('still calls the bridge over HTTP', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        total_hits: 1,
        results: [{
          book_id: 3, book_name: 'صحيح مسلم', author_name: 'مسلم',
          volume: 2, page: '88', content: 'متن الحديث', highlighted: null,
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const [hit] = await searchLocalShamela('نية');

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/search');
    expect(hit.citation_ref.book).toBe('صحيح مسلم');
    expect(hit.citation_ref.scholar).toBe('مسلم');
    expect(hit.citation_ref.volume).toBe(2);
    expect(hit.citation_ref.page).toBe(88);
  });

  it('returns nothing when the bridge was never connected', async () => {
    localStorage.setItem('shamela.connected', '0');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await searchLocalShamela('نية')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats an unreachable bridge as no hits, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await searchLocalShamela('نية')).toEqual([]);
  });
});
