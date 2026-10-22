/**
 * ADR-0045 / plan §2.3 — resolve جوامع الكلم narrator ids to display names from
 * the Supabase rijāl corpora. The Electron main process cannot reach the
 * signed-in tables, so the sanad-tree node labels and the narrator card do this
 * renderer-side.
 *
 * `islamicurdubooks-rijal` rows carry `citation_ref.rawy_id`; `classical-rijal`
 * is a fallback keyed by name. We only need the id→name map here — the card's
 * prose/citations come through the agent bridge.
 */
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";

const log = logger.child("jkhssn/resolveNames");

export interface ResolvedNarrator {
  rawyId: number;
  nameAr: string | null;
  shuhraAr: string | null;
  sourceUrl: string | null;
}

const cache = new Map<number, ResolvedNarrator | null>();

function readCitation(ref: unknown): Record<string, unknown> {
  return ref && typeof ref === "object" ? (ref as Record<string, unknown>) : {};
}

/**
 * Batch-resolve narrator ids. Unknown ids resolve to `null` and are cached so a
 * re-render doesn't re-query them. Never throws — a failed lookup just leaves
 * the tree node showing "نام دستیاب نہیں".
 */
export async function resolveNarratorNames(rawyIds: number[]): Promise<Map<number, ResolvedNarrator>> {
  const out = new Map<number, ResolvedNarrator>();
  const missing: number[] = [];
  for (const id of new Set(rawyIds)) {
    if (!Number.isFinite(id) || id <= 0) continue;
    if (cache.has(id)) {
      const hit = cache.get(id);
      if (hit) out.set(id, hit);
    } else {
      missing.push(id);
    }
  }
  if (missing.length === 0) return out;

  try {
    // Through the server: the browser can no longer read this table directly.
    const { data: reply, error } = await supabase.functions.invoke("corpus-reads", {
      body: { action: "narrator-names", rawyIds: missing },
    });
    if (error) throw error;
    const data = (reply as { rows?: Array<{ citation_ref: unknown; source_url: string | null; title: string | null }> } | null)?.rows;

    for (const row of data ?? []) {
      const cr = readCitation(row.citation_ref);
      const id = Number(cr.rawy_id);
      if (!Number.isFinite(id) || cache.get(id)) continue;
      const resolved: ResolvedNarrator = {
        rawyId: id,
        nameAr: (cr.name_ar as string) ?? (row.title as string) ?? null,
        shuhraAr: (cr.shuhra_ar as string) ?? (cr.shuhra as string) ?? null,
        sourceUrl: (row.source_url as string) ?? null,
      };
      cache.set(id, resolved);
      out.set(id, resolved);
    }
  } catch (err) {
    log.warn("narrator name resolution failed", { err });
  }

  // Cache the ones that came back empty so we don't hammer the table.
  for (const id of missing) if (!cache.has(id)) cache.set(id, null);
  return out;
}

/** For tests / a manual reset. */
export function _clearResolveCache(): void {
  cache.clear();
}
