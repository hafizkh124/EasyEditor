/**
 * M11 — reshape a finished run's citable tool-call results into
 * `CitationItem[]` for `CitationPanel`, the primary discoverable surface for
 * "which sources were retrieved" on an agent turn. Before this, an agent
 * answer's provenance was buried in a collapsible raw tool-call JSON dump
 * (`agent.showTools`) — kept as a debug toggle, no longer the only view.
 *
 * Every citable tool (`CITABLE_SEARCH_TOOLS`) already normalizes its results
 * into a flat `{ id, reference, excerpt?, url?/source_url? }[]` under
 * `results` (or, for `research_topic`, `sources`) before returning — this is
 * the same shape the retrieval ledger stores server-side. Three جوامع الكلم
 * tools (`jkhssn_narrator`, `jkhssn_takhrij`, `jkhssn_judgments`) return a
 * card/answer shape instead and are silently skipped here, not because they
 * aren't citable (they add to the ledger too) but because that shape isn't
 * exposed in the tool-call result the renderer receives — their content is
 * still visible via the artifact panel and the raw tool-call view.
 *
 * `CitationItem.citation_ref` only ever gets `title` set here — the flat
 * `reference` string is already a complete, formatted citation (built
 * server-side per domain), not raw fields to re-parse. `CitationBadge`'s
 * "Classical" branch (`ref.title`) renders that as-is.
 *
 * Pure — no runtime globals.
 */
import type { CitationItem } from '../research/citationTypes.js';
import { CITABLE_SEARCH_TOOLS } from './toolScoping.js';
import { connectorForTool } from './connectors.js';

interface ToolCallLike {
  name: string;
  result: unknown;
}

interface ResultRow {
  id?: unknown;
  reference?: unknown;
  excerpt?: unknown;
  excerpt_ar?: unknown;
  url?: unknown;
  source_url?: unknown;
}

function rowsOf(result: unknown): ResultRow[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;
  const rows = Array.isArray(r.results) ? r.results : Array.isArray(r.sources) ? r.sources : null;
  return rows ?? [];
}

export function citationsFromToolCalls(toolCalls: ToolCallLike[]): CitationItem[] {
  const out: CitationItem[] = [];
  const citable = CITABLE_SEARCH_TOOLS as readonly string[];
  for (const call of toolCalls) {
    if (!citable.includes(call.name)) continue;
    const domain = connectorForTool(call.name) ?? call.name;
    for (const row of rowsOf(call.result)) {
      const reference = typeof row.reference === 'string' ? row.reference.trim() : '';
      if (!reference) continue;
      const url = typeof row.url === 'string' ? row.url : typeof row.source_url === 'string' ? row.source_url : undefined;
      // The tool already returns the retrieved text; carry it through so the
      // panel can show and copy the passage, not just its reference label.
      const content = typeof row.excerpt === 'string' && row.excerpt.trim() ? row.excerpt.trim() : undefined;
      const contentAr = typeof row.excerpt_ar === 'string' && row.excerpt_ar.trim() ? row.excerpt_ar.trim() : undefined;
      out.push({ domain, citation_ref: { title: reference }, url, ...(content ? { content } : {}), ...(contentAr ? { content_ar: contentAr } : {}) });
    }
  }
  return out;
}
