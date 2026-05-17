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

async function callEmbedBatch(texts: string[], lovableKey: string): Promise<number[][]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/text-embedding-004",
      input: texts,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const arr  = data?.data;
  if (!Array.isArray(arr)) throw new Error("Unexpected embedding response shape");
  return arr.map((d: any) => d.embedding);
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
    const lovableKey   = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
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
      // Also report whether we are fully done across the whole table
      const { count: stillPending } = await supabase
        .from("scholarly_documents")
        .select("id", { count: "exact", head: true })
        .is("embedding", null);
      return new Response(JSON.stringify({
        processed:        0,
        remaining_total:  stillPending ?? 0,
        done:             (stillPending ?? 0) === 0,
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
      vectors = await callEmbedBatch(texts, lovableKey);
    } catch (e) {
      // Retry once on transient failure
      console.warn("[backfill-embeddings] embed retry:", e);
      vectors = await callEmbedBatch(texts, lovableKey);
    }

    if (vectors.length !== rows.length) {
      throw new Error(`Embedding count mismatch: got ${vectors.length}, expected ${rows.length}`);
    }

    // ── UPDATE in parallel (small, indexed point-updates) ─────────────────
    let updated = 0;
    const errors: string[] = [];
    await Promise.all(rows.map(async (row, i) => {
      const { error: updErr } = await supabase
        .from("scholarly_documents")
        .update({ embedding: vectors[i] })
        .eq("id", (row as any).id);
      if (updErr) errors.push(`${(row as any).id}: ${updErr.message}`);
      else updated += 1;
    }));

    // ── Report remaining work so the orchestrator knows when to stop ─────
    const { count: stillPending } = await supabase
      .from("scholarly_documents")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    return new Response(JSON.stringify({
      processed:        updated,
      attempted:        rows.length,
      remaining_total:  stillPending ?? 0,
      done:             (stillPending ?? 0) === 0,
      errors:           errors.slice(0, 5),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("backfill-embeddings error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
