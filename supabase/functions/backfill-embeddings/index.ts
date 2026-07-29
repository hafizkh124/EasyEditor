// Embedding backfill for scholarly_documents.
//
// Generates vector embeddings for existing rows that have embedding IS NULL.
// Called repeatedly by a local Python orchestrator (one batch per call) so
// progress is incremental and resumable.
//
// Auth: shared secret (same envelope as `ingest-batch`).
//
// Why a dedicated function: `ingest-scholarly-data` reads from Storage CSVs
// at ingest time. Our 97K rows are already in the table without embeddings —
// they need an in-place UPDATE pass, not another insert.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EMBED_MODEL, EMBED_DIMS } from "../../../shared/ai/embedConstants.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Per-call cap. text-embedding-004 supports batches of 100; we keep it
// modest so a single statement_timeout-bounded UPDATE round doesn't get
// killed by Postgres.
const DEFAULT_BATCH = 50;
const MAX_BATCH     = 100;

interface RowToEmbed {
  id:           string;
  content:      string | null;
  content_ar:   string | null;
}

/** Count rows with NULL embedding. Filters by sourceType when provided so the
 *  orchestrator's per-domain progress is accurate. Returns `{remaining, error}`
 *  with `error` set if the count itself failed (we then never signal done). */
async function countRemaining(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  sourceType: string | null,
): Promise<{ remaining: number | null; error: Error | null }> {
  try {
    let q = supabase
      .from("scholarly_documents")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);
    if (sourceType) q = q.eq("source_type", sourceType);
    const { count, error } = await q;
    if (error) return { remaining: null, error };
    // count can be null when the head request fails silently — treat as error
    if (count === null || count === undefined) {
      return { remaining: null, error: new Error("count returned null") };
    }
    return { remaining: count, error: null };
  } catch (e) {
    return { remaining: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// Embed via Google AI Studio's Generative Language API directly.
// The Lovable AI Gateway does not expose the embeddings endpoint on every
// workspace tier (returns 404 "route_not_found"), so we call Google directly
// using GEMINI_API_KEY. This endpoint is free tier-friendly.
//
// Model + dimensionality come from shared/ai/embedConstants.ts (imported at
// the top) — the single source of truth for every runtime. They used to be
// redeclared here, which is precisely how the corpus and the query path can
// drift into different vector spaces.

async function callEmbedBatch(texts: string[], geminiKey: string): Promise<number[][]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;
  const requests = texts.map((t) => ({
    model:                `models/${EMBED_MODEL}`,
    content:              { parts: [{ text: t || " " }] },
    outputDimensionality: EMBED_DIMS,
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": geminiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const arr  = data?.embeddings;
  if (!Array.isArray(arr)) throw new Error("Unexpected embedding response shape");
  return arr.map((e: any) => e.values as number[]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  try {
    // ── Auth (shared secret) ──────────────────────────────────────────────
    const secret = req.headers.get("x-ingest-secret");
    const expected = Deno.env.get("INGEST_SHARED_SECRET");
    if (!expected || secret !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(MAX_BATCH, Math.max(1, Number(body?.batchSize ?? DEFAULT_BATCH)));
    // Optional: restrict to one source_type per call (gives the operator
    // control over priority — backfill quran first, then hadith).
    const sourceType: string | null = body?.sourceType ?? null;

    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey    = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    // ── Pick rows that still need an embedding ────────────────────────────
    let query = supabase
      .from("scholarly_documents")
      .select("id, content, content_ar")
      .is("embedding", null)
      .limit(batchSize);
    if (sourceType) query = query.eq("source_type", sourceType);

    const { data: rows, error: selErr } = await query;
    if (selErr) throw selErr;
    if (!rows || rows.length === 0) {
      // When the orchestrator specified a sourceType, the relevant "remaining"
      // is FOR THAT source_type — not the whole table. Mixing scopes is what
      // caused the orchestrator to falsely terminate earlier.
      const { remaining, error: countErr } = await countRemaining(supabase, sourceType);
      if (countErr) {
        // Count flaked out — DO NOT signal done. Tell orchestrator to retry.
        return new Response(JSON.stringify({
          processed:        0,
          attempted:        0,
          remaining_total:  null,
          done:             false,
          count_error:      countErr.message ?? "count failed",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        processed:        0,
        attempted:        0,
        remaining_total:  remaining ?? 0,
        done:             (remaining ?? 0) === 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build input strings — prefer content_ar (Arabic) then English content.
    // Strip nothing here: embeddings handle diacritics fine, and we keep
    // the input text aligned with what users will actually search against.
    const texts: string[] = (rows as RowToEmbed[]).map((r) =>
      ((r.content_ar?.trim() || r.content?.trim() || "") + "").slice(0, 4000),
    );

    let vectors: number[][];
    try {
      vectors = await callEmbedBatch(texts, geminiKey);
    } catch (e) {
      // Retry once on transient failure
      console.warn("[backfill-embeddings] embed retry:", e);
      vectors = await callEmbedBatch(texts, geminiKey);
    }

    if (vectors.length !== rows.length) {
      throw new Error(`Embedding count mismatch: got ${vectors.length}, expected ${rows.length}`);
    }

    // ── UPDATE sequentially and resiliently ──────────────────────────────
    let updated = 0;
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as any;
      try {
        const { error: updErr } = await supabase
          .from("scholarly_documents")
          .update({ embedding: vectors[i] })
          .eq("id", row.id);
        if (updErr) {
          errors.push(`${row.id}: ${updErr.message}`);
        } else {
          updated += 1;
        }
      } catch (e) {
        errors.push(`${row.id}: ${String(e)}`);
      }
    }

    // ── Report remaining work so the orchestrator knows when to stop ─────
    // Critical safety: if we processed > 0 rows this batch, NEVER signal
    // done=true. A productive batch cannot be the last one. Also count
    // remaining within the same source_type the caller asked for, so the
    // orchestrator's per-domain progress is meaningful.
    const { remaining, error: countErr } = await countRemaining(supabase, sourceType);

    const productive = updated > 0;
    const doneFlag   = !productive && !countErr && (remaining ?? 0) === 0;

    return new Response(JSON.stringify({
      processed:        updated,
      attempted:        rows.length,
      remaining_total:  countErr ? null : (remaining ?? 0),
      done:             doneFlag,
      ...(countErr ? { count_error: countErr.message ?? "count failed" } : {}),
      errors:           errors.slice(0, 5),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("backfill-embeddings error:", e);
    const msg = (e as any)?.message || (e as any)?.details || (typeof e === 'object' ? JSON.stringify(e) : String(e));
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
