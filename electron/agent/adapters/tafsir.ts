/**
 * M9 Phase 1 — the agent's bridge to the Tafsir MCP client (ADR-0022).
 *
 * `electron/tafsir/mcpClient.ts` already speaks to tafsir.net (remote) or a
 * local `uvx tafsir-mcp` process, with a per-tool allowlist + arg sanitiser.
 * This wraps it for `query_tafseer`: connect on demand (remote first), map the
 * agent's `mode` to an allowlisted tool, and turn the result into citable
 * `RetrievedChunk`s — book + sūrah + āyah is exactly what `insert_footnote`
 * needs.
 */
import { logger } from '../../lib/logger.js';
import { isConnected, connectRemote, connectLocal, callTool } from '../../tafsir/mcpClient.js';
import path from 'node:path';
import { parseAyahRef, surahLabel } from '../../../shared/quran/surahNames.js';
import type { RetrievedChunk } from '../../../shared/agent/grounding.js';

const log = logger.child('agent/tafsir');

export type TafseerMode = 'ayah' | 'tafsir' | 'nuzool' | 'word' | 'search';

export interface TafseerQuery {
  reference: string;
  mode: TafseerMode;
  sources?: string[];
  query?: string;
  word_no?: number;
}

export interface TafseerResult {
  chunks: RetrievedChunk[];
  text: string;
  note?: string;
  error?: string;
}

let connectAttempted = false;

/** Connect the MCP client if it is not already up. Remote first; local only if its DB is present. */
async function ensureConnected(): Promise<boolean> {
  if (isConnected()) return true;
  if (connectAttempted && !isConnected()) {
    // one retry per process is enough; a persistent failure is a clean "unavailable"
  }
  connectAttempted = true;
  try {
    await connectRemote();
    return true;
  } catch (err) {
    log.warn('tafsir remote connect failed, trying local', { message: (err as Error).message });
  }
  try {
    const { app } = await import('electron');
    const { getLocalRuntime } = await import('../../tafsir/localRuntime.js');
    const runtime = getLocalRuntime(path.join(app.getPath('userData'), 'tafsir'));
    if (!runtime.detect().dbFound) return false;
    const params = runtime.buildStdioParams();
    if (!params) return false;
    await connectLocal(params);
    return true;
  } catch (err) {
    log.warn('tafsir local connect failed', { message: (err as Error).message });
    return false;
  }
}

const MODE_TOOL: Record<TafseerMode, string> = {
  ayah: 'fetch_ayah',
  tafsir: 'fetch_tafsir',
  nuzool: 'fetch_nuzool_reason',
  word: 'analyze_word',
  search: 'search_in_tafsir',
};

export async function queryTafseer(q: TafseerQuery): Promise<TafseerResult> {
  const ok = await ensureConnected();
  if (!ok) {
    return { chunks: [], text: '', error: 'The Tafsir sources are not reachable — connect them in the Tafsir panel (or install the local database).' };
  }

  const tool = MODE_TOOL[q.mode];
  if (!tool) return { chunks: [], text: '', error: `unknown tafsir mode "${q.mode}"` };

  // `search` works on a free-text query; the others need a sūrah:āyah.
  let args: Record<string, unknown>;
  let refLabel: string;
  if (q.mode === 'search') {
    const query = (q.query ?? q.reference).trim();
    if (!query) return { chunks: [], text: '', error: 'search mode needs a `query`' };
    args = { query, limit: 6, ...(q.sources?.[0] ? { source: q.sources[0] } : {}) };
    refLabel = `بحث في التفاسير: «${query}»`;
  } else {
    const parsed = parseAyahRef(q.reference);
    if (!parsed) {
      return { chunks: [], text: '', error: `could not read the āyah reference "${q.reference}" — use "surah:ayah", e.g. "2:255"` };
    }
    const { surah, ayah } = parsed;
    refLabel = `${surahLabel(surah)}: ${ayah}`;
    args = { surah, ayah };
    if (q.mode === 'tafsir' || q.mode === 'nuzool') {
      if (q.sources?.length) args.sources = q.sources;
    }
    if (q.mode === 'word') args.word_no = q.word_no ?? 1;
  }

  let text = '';
  try {
    const res = await callTool(tool, args);
    text = res.text ?? '';
  } catch (err) {
    return { chunks: [], text: '', error: `tafsir lookup failed: ${(err as Error).message}` };
  }
  if (!text.trim()) return { chunks: [], text: '', note: 'The tafsir sources returned nothing for that reference.' };

  const sourceLabel = q.sources?.length ? ` (${q.sources.join('، ')})` : '';
  const kind =
    q.mode === 'nuzool' ? 'سبب النزول'
    : q.mode === 'word' ? 'تحليل لفظي'
    : q.mode === 'ayah' ? 'نص الآية'
    : 'تفسير';
  const chunk: RetrievedChunk = {
    id: `tafsir:${q.mode}:${(q.sources?.[0] ?? 'all')}:${refLabel}`,
    reference: `${kind}${sourceLabel} — ${refLabel} (tafsir.net)`,
    content: text.slice(0, 4000),
  };

  return { chunks: [chunk], text: text.slice(0, 6000) };
}
