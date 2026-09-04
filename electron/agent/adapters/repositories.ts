/**
 * M9 Phase 9 (ADR-0028) — the agent's bridge to the global scholarly
 * repositories.
 *
 * Two fixed, named public endpoints — the Internet Archive's `advancedsearch`
 * and OpenAlex's `/works`. Neither needs auth, so this runs directly in the
 * main process (like the Tafsir MCP client), not renderer-bridged. This is not
 * open browsing: the URLs are constructed here from a query, nothing else.
 *
 * Results are BIBLIOGRAPHIC only — a work reference, never a passage the agent
 * has read (see `normaliseArchive` / `normaliseOpenAlex`).
 */
import { logger } from '../../lib/logger.js';
import { normaliseArchive, normaliseOpenAlex, type RepositoryId } from '../../../shared/research/repositories.js';
import type { RetrievedChunk } from '../../../shared/agent/grounding.js';

const log = logger.child('agent/repositories');

/**
 * OpenAlex's "polite pool" wants a contact in the query. A GENERIC project
 * contact — never the signed-in scholar's address (ADR-0028 privacy note).
 */
const OPENALEX_CONTACT = 'agent@easyeditor.app';
const TIMEOUT_MS = 12_000;
const ARCHIVE_UA = 'EasyEditor-Agent/1.0 (scholarly research; contact agent@easyeditor.app)';

export interface RepositoryQuery {
  query: string;
  repo?: RepositoryId | 'all';
  limit?: number;
}

export interface RepositoryResult {
  chunks: RetrievedChunk[];
  note?: string;
  error?: string;
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchArchive(query: string, limit: number): Promise<RetrievedChunk[]> {
  const q = `title:(${query}) OR description:(${query})`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=mediatype` +
    `&rows=${limit}&page=1&output=json`;
  return normaliseArchive(await fetchJson(url, { 'User-Agent': ARCHIVE_UA }));
}

async function searchOpenAlex(query: string, limit: number): Promise<RetrievedChunk[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}` +
    `&select=id,doi,title,display_name,publication_year,authorships,primary_location` +
    `&per_page=${limit}&mailto=${encodeURIComponent(OPENALEX_CONTACT)}`;
  return normaliseOpenAlex(await fetchJson(url));
}

export async function searchRepositories(q: RepositoryQuery): Promise<RepositoryResult> {
  const query = q.query.trim();
  if (!query) return { chunks: [], error: 'a search query is required' };
  const limit = Math.min(Math.max(q.limit ?? 5, 1), 8);
  const repo = q.repo ?? 'all';

  const jobs: Array<Promise<RetrievedChunk[]>> = [];
  if (repo === 'archive' || repo === 'all') jobs.push(searchArchive(query, limit).catch((e) => { log.warn('archive.org failed', { message: (e as Error).message }); return []; }));
  if (repo === 'openalex' || repo === 'all') jobs.push(searchOpenAlex(query, limit).catch((e) => { log.warn('openalex failed', { message: (e as Error).message }); return []; }));

  const chunks = (await Promise.all(jobs)).flat().slice(0, limit * 2);
  if (chunks.length === 0) {
    return { chunks: [], note: 'No matching works in the global repositories (or they did not respond).' };
  }
  return {
    chunks,
    note: 'These are bibliographic references to WORKS, not passages. Cite them with insert_footnote WITHOUT a `claim`; to quote from one, find the passage in Shamela or the personal corpus.',
  };
}
