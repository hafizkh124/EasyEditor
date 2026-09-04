/**
 * M9 Phase 9 (ADR-0028) — normalise Internet Archive + OpenAlex responses into
 * BIBLIOGRAPHIC references.
 *
 * Neither source gives verifiable full text an agent could quote: Archive.org
 * returns a scanned edition (a page image), OpenAlex returns metadata only. So
 * a repository hit cites a *work* — author, title, year, link — and can never
 * carry a `claim` (see `insert_footnote`'s guard). That is why every chunk
 * built here is `bibliographic: true`.
 *
 * Pure — no runtime globals.
 */
import type { RetrievedChunk } from '../agent/grounding.js';

export type RepositoryId = 'archive' | 'openalex';

// ── Internet Archive: advancedsearch.php JSON ──────────────────────────────

interface ArchiveDoc {
  identifier?: string;
  title?: string | string[];
  creator?: string | string[];
  year?: string | number;
  mediatype?: string;
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

export function normaliseArchive(json: unknown): RetrievedChunk[] {
  const docs = (json as { response?: { docs?: ArchiveDoc[] } })?.response?.docs ?? [];
  const out: RetrievedChunk[] = [];
  for (const d of docs) {
    if (!d.identifier || !first(d.title)) continue;
    const author = first(d.creator);
    const year = d.year != null ? String(d.year) : '';
    const bits = [author, `«${first(d.title)}»`, year].filter(Boolean);
    out.push({
      id: `archive:${d.identifier}`,
      reference: `${bits.join('، ')} — archive.org/details/${d.identifier}`,
      source_url: `https://archive.org/details/${d.identifier}`,
      bibliographic: true,
    });
  }
  return out;
}

// ── OpenAlex: /works JSON ─────────────────────────────────────────────────

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string | null } | null } | null;
}

export function normaliseOpenAlex(json: unknown): RetrievedChunk[] {
  const results = (json as { results?: OpenAlexWork[] })?.results ?? [];
  const out: RetrievedChunk[] = [];
  for (const w of results) {
    const title = (w.title ?? w.display_name ?? '').trim();
    if (!title) continue;
    const authors = (w.authorships ?? [])
      .map((a) => a.author?.display_name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 3);
    const authorStr = authors.length ? (w.authorships!.length > 3 ? `${authors.join(', ')} et al.` : authors.join(', ')) : '';
    const venue = w.primary_location?.source?.display_name ?? '';
    const year = w.publication_year != null ? String(w.publication_year) : '';
    const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, '') : '';
    const bits = [authorStr, `“${title}”`, venue, year].filter(Boolean);
    const key = doi || (w.id ?? '').replace('https://openalex.org/', 'openalex/');
    out.push({
      id: `openalex:${key}`,
      reference: `${bits.join('. ')}${doi ? `. https://doi.org/${doi}` : ''}`,
      source_url: w.doi ?? w.id ?? undefined,
      bibliographic: true,
    });
  }
  return out;
}
