/**
 * ingest-scholarly-data — Admin-only batch ingestor for scholarly_documents
 *
 * IMPORTANT: This function handles small pre-processed batches only (≤500 rows).
 * Large corpora (Shamela CSV 14.74 GB, OpenITI 5.9 GB) MUST be imported via
 * psql COPY or pgloader directly — NOT through this edge function.
 *
 * Invocation (CLI):
 *   supabase functions invoke ingest-scholarly-data \
 *     --data '{"dataset":"hadith-json","batchStart":0,"batchSize":500}'
 *
 * Full hadith-json run (102 batches of 500):
 *   for i in $(seq 0 101); do
 *     supabase functions invoke ingest-scholarly-data \
 *       --data "{\"dataset\":\"hadith-json\",\"batchStart\":$((i*500)),\"batchSize\":500}"
 *     sleep 2
 *   done
 *
 * Flow per batch:
 *   1. Validate service_role key (reject all other callers)
 *   2. Read pre-processed JSON from Supabase Storage bucket: ingest-data/{dataset}/{offset}.json
 *   3. For each 100-doc chunk: embed via text-embedding-004 (batch embedding)
 *   4. INSERT INTO scholarly_documents ... ON CONFLICT DO NOTHING
 *   5. Update ingest_jobs table
 *   6. Return { processed, skipped, errors }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Arabic normalizer ─────────────────────────────────────────────────────────
function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    .trim();
}

interface IngestDoc {
  domain: string;
  source_type: string;
  title?: string;
  content: string;
  content_ar?: string;
  citation_ref: Record<string, unknown>;
  language: "ar" | "en" | "ur";
  source_url?: string;
}

// ── Embed up to 100 texts in one API call ─────────────────────────────────────
// Uses Gemini direct (primary) with Lovable AI Gateway as fallback.
import { callEmbeddings } from "../_shared/aiGateway.ts";

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await callEmbeddings({
    model: "google/text-embedding-004",
    input: texts,
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(`Embedding API error ${res.status}: ${errTxt}`);
  }

  const data = await res.json();
  return (data.data as any[])
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding as number[]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── 1. Validate service_role key ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const providedKey = authHeader.replace("Bearer ", "").trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (providedKey !== serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Forbidden — service_role key required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { dataset, batchStart = 0, batchSize = 500 } = await req.json();

    if (!dataset) {
      return new Response(JSON.stringify({ error: "dataset is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (batchSize > 500) {
      return new Response(JSON.stringify({ error: "batchSize must be ≤ 500" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl     = Deno.env.get("SUPABASE_URL")!;
    const supabase        = createClient(supabaseUrl, serviceRoleKey);

    // ── 2. Read pre-processed JSON batch from Storage ─────────────────────────
    // Path convention: ingest-data/{dataset}/{batchStart}.json
    // Each file is a JSON array of IngestDoc objects (pre-processed offline).
    const storagePath = `${dataset}/${batchStart}.json`;
    const { data: fileData, error: storageErr } = await supabase.storage
      .from("ingest-data")
      .download(storagePath);

    if (storageErr || !fileData) {
      return new Response(JSON.stringify({
        error: `Storage file not found: ${storagePath}`,
        details: storageErr?.message,
      }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawText = await fileData.text();
    let docs: IngestDoc[];
    try {
      docs = JSON.parse(rawText);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON in batch file" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(docs) || docs.length === 0) {
      return new Response(JSON.stringify({ processed: 0, skipped: 0, errors: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Update / create ingest_jobs row ────────────────────────────────────
    const { data: existingJob } = await supabase
      .from("ingest_jobs")
      .select("id, processed")
      .eq("dataset", dataset)
      .eq("status", "running")
      .maybeSingle();

    let jobId: string;
    if (existingJob) {
      jobId = existingJob.id;
    } else {
      const { data: newJob } = await supabase
        .from("ingest_jobs")
        .insert({ dataset, status: "running", started_at: new Date().toISOString() })
        .select("id")
        .single();
      jobId = newJob!.id;
    }

    // ── 4. Embed in chunks of 100, then upsert ────────────────────────────────
    const CHUNK = 100;
    let processed = 0;
    let skipped   = 0;
    let errors    = 0;

    for (let i = 0; i < docs.length; i += CHUNK) {
      const chunk = docs.slice(i, i + CHUNK);

      // Build embed texts: normalize Arabic content for better recall
      const embedTexts = chunk.map((doc) =>
        normalizeArabic(doc.content_ar ?? doc.content).slice(0, 2048)
      );

      let embeddings: number[][];
      try {
        embeddings = await embedBatch(embedTexts);
      } catch (embErr) {
        console.error(`Embedding chunk ${i} failed:`, embErr);
        errors += chunk.length;
        continue;
      }

      // Build rows for insert
      const rows = chunk.map((doc, idx) => ({
        domain:       doc.domain,
        source_type:  doc.source_type,
        title:        doc.title ?? null,
        content:      doc.content,
        content_ar:   doc.content_ar ?? null,
        citation_ref: doc.citation_ref,
        language:     doc.language,
        embedding:    `[${embeddings[idx].join(",")}]`,  // pgvector text format
        source_url:   doc.source_url ?? null,
      }));

      const { error: insertErr, count } = await supabase
        .from("scholarly_documents")
        .insert(rows, { count: "estimated" })
        .select();

      if (insertErr) {
        // ON CONFLICT DO NOTHING is handled by unique indexes; log other errors
        if (insertErr.code === "23505") {
          // unique violation — expected for re-runs, count as skipped
          skipped += chunk.length;
        } else {
          console.error("Insert error:", insertErr);
          errors += chunk.length;
        }
      } else {
        processed += count ?? chunk.length;
      }
    }

    // ── 5. Update ingest_jobs ─────────────────────────────────────────────────
    const totalProcessed = (existingJob?.processed ?? 0) + processed;
    await supabase
      .from("ingest_jobs")
      .update({
        processed: totalProcessed,
        errors: errors,
        notes: `Last batch: start=${batchStart}, size=${docs.length}`,
      })
      .eq("id", jobId);

    return new Response(
      JSON.stringify({ processed, skipped, errors, jobId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("ingest-scholarly-data error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
