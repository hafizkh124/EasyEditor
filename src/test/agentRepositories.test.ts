// @vitest-environment node
// shared/research/repositories.ts + electron/agent/adapters/repositories.ts
// (M9 Phase 9, ADR-0028). Two fixed public endpoints (Internet Archive +
// OpenAlex). Results are BIBLIOGRAPHIC only — a work reference, never a passage
// — so every chunk is `bibliographic: true`. The scholar's own email never
// leaves the machine.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normaliseArchive, normaliseOpenAlex } from '../../shared/research/repositories';

describe('normaliseArchive', () => {
  it('turns advancedsearch docs into archive.org/details references', () => {
    const chunks = normaliseArchive({
      response: { docs: [
        { identifier: 'GhazaliIhya3', title: 'Ihya ulum al-din, vol. 3', creator: 'al-Ghazali', year: 1998, mediatype: 'texts' },
        { identifier: 'noTitle' },
      ] },
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ id: 'archive:GhazaliIhya3', bibliographic: true });
    expect(chunks[0].reference).toContain('archive.org/details/GhazaliIhya3');
    expect(chunks[0].source_url).toBe('https://archive.org/details/GhazaliIhya3');
  });
});

describe('normaliseOpenAlex', () => {
  it('turns works into author-title-venue-year references with the DOI', () => {
    const chunks = normaliseOpenAlex({
      results: [{
        id: 'https://openalex.org/W123', doi: 'https://doi.org/10.1000/xyz',
        title: 'Maqasid Al-Shariah as Philosophy of Islamic Law', publication_year: 2008,
        authorships: [{ author: { display_name: 'Jasser Auda' } }],
        primary_location: { source: { display_name: 'IIIT eBooks' } },
      }],
    });
    expect(chunks[0]).toMatchObject({ id: 'openalex:10.1000/xyz', bibliographic: true });
    expect(chunks[0].reference).toContain('Jasser Auda');
    expect(chunks[0].reference).toContain('doi.org/10.1000/xyz');
  });

  it('drops a result with no title and truncates a long author list', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ author: { display_name: `A${i}` } }));
    const chunks = normaliseOpenAlex({ results: [{ title: null }, { title: 'X', authorships: many }] });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].reference).toMatch(/A0, A1, A2 et al\./);
  });
});

describe('searchRepositories', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  it('queries both endpoints for repo "all", never sends the user email', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ response: { docs: [{ identifier: 'A1', title: 'Book', creator: 'X', year: 2000 }] } }))
      .mockResolvedValueOnce(jsonRes({ results: [{ title: 'Paper', publication_year: 2021 }] }));
    const { searchRepositories } = await import('../../electron/agent/adapters/repositories');
    const r = await searchRepositories({ query: 'ijtihad', repo: 'all' });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith('https://archive.org/advancedsearch.php'))).toBe(true);
    expect(urls.some((u) => u.startsWith('https://api.openalex.org/works'))).toBe(true);
    // the polite-pool contact is a generic project address, not a user's
    expect(urls.find((u) => u.includes('openalex'))).toContain('mailto=agent%40easyeditor.app');
    expect(urls.join(' ')).not.toMatch(/hafiz|gmail/i);

    expect(r.chunks).toHaveLength(2);
    expect(r.chunks.every((c) => c.bibliographic)).toBe(true);
    expect(r.note).toMatch(/WITHOUT a `claim`/);
  });

  it('a single-repo query hits only that endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ results: [{ title: 'Paper' }] }));
    const { searchRepositories } = await import('../../electron/agent/adapters/repositories');
    await searchRepositories({ query: 'x', repo: 'openalex' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('openalex');
  });

  it('a failing endpoint degrades to a clean note, not a throw', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const { searchRepositories } = await import('../../electron/agent/adapters/repositories');
    const r = await searchRepositories({ query: 'x', repo: 'all' });
    expect(r.error).toBeUndefined();
    expect(r.chunks).toHaveLength(0);
    expect(r.note).toMatch(/did not respond/i);
  });
});
