/**
 * Connectors Hub (Phase 7, ADR-0042) — the agent's bridge to Ganjoor.
 *
 * `api.ganjoor.net` is a fixed, named public API (no auth), so this runs
 * directly in the main process like `adapters/repositories.ts` (ADR-0028): the
 * URL is built here from a search phrase and nothing else. Persian only.
 */
import { logger } from '../../lib/logger.js';
import { normaliseGanjoor, findPoetId } from '../../../shared/research/ganjoor.js';
import type { RetrievedChunk } from '../../../shared/agent/grounding.js';

const log = logger.child('agent/ganjoor');

const API = 'https://api.ganjoor.net/api/ganjoor';
const TIMEOUT_MS = 12_000;
const HEADERS = { Accept: 'application/json', 'User-Agent': 'EasyEditor-Agent/1.0 (scholarly research)' };

export interface PersianPoetryResult {
  chunks: RetrievedChunk[];
  note?: string;
  error?: string;
}

export async function searchPersianPoetry(input: { query: string; poet?: string }): Promise<PersianPoetryResult> {
  const term = (input.query ?? '').trim();
  if (!term) return { chunks: [], error: 'a search phrase is required' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ term, page: '1', pageSize: '6' });
    if (input.poet?.trim()) {
      const poetId = await resolvePoetId(input.poet.trim(), ctrl.signal);
      if (poetId) params.set('poetId', String(poetId));
    }
    const res = await fetch(`${API}/poems/search?${params.toString()}`, { signal: ctrl.signal, headers: HEADERS });
    if (!res.ok) return { chunks: [], error: `Ganjoor returned HTTP ${res.status}` };
    const chunks = normaliseGanjoor(await res.json(), 6);
    return chunks.length ? { chunks } : { chunks: [], note: 'گنجور returned no matching Persian verses for that phrase.' };
  } catch (err) {
    const aborted = ctrl.signal.aborted;
    log.warn('ganjoor search failed', { message: (err as Error).message });
    return {
      chunks: [],
      error: aborted ? 'گنجور did not respond in time' : `Ganjoor lookup failed: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePoetId(name: string, signal: AbortSignal): Promise<number> {
  try {
    const res = await fetch(`${API}/poets`, { signal, headers: HEADERS });
    if (!res.ok) return 0;
    return findPoetId(await res.json(), name);
  } catch {
    return 0;
  }
}

/** Health probe URL for the Connectors Hub (`healthKind: 'http'`). */
export const GANJOOR_HEALTH_URL = `${API}/poets`;
