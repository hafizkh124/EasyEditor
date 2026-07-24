import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // SECURITY: shared secret authorization
    const ingestSecret = req.headers.get("x-ingest-secret");
    const sharedSecret = Deno.env.get("INGEST_SHARED_SECRET");
    if (!ingestSecret || ingestSecret !== sharedSecret) {
      console.error("Unauthorized ingest attempt");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = await req.json();
    const { rows, mode } = body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: "rows array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (rows.length > 500) {
      return new Response(JSON.stringify({ error: "Max 500 rows per batch" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    for (const row of rows) {
      if (!row.domain || !row.source_type || !row.content) {
        return new Response(
          JSON.stringify({ error: "Each row needs domain, source_type, content" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // mode: "check" — read-only pre-flight for bulk-load scripts. Reports,
    // per row, whether it already exists and why (exact content repeat, same
    // hadith/verse citation, or the same Arabic text under a different
    // domain) WITHOUT inserting anything. See scholarly_documents_check_batch
    // (20260724220000_ar_fingerprint_and_check_batch.sql) and
    // scripts/supabase_bulk_load.py --check-only.
    if (mode === "check") {
      const { data, error } = await supabase.rpc("scholarly_documents_check_batch", {
        payload: rows,
      });
      if (error) throw error;
      return new Response(
        JSON.stringify({ checked: rows.length, results: data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Duplicate-aware ingestion strategy:
    //
    // The scholarly_documents table now enforces unique indexes per domain
    // (openiti_id, hadith collection+number, quran surah+verse, and a universal
    // exact-content hash). A naive bulk INSERT would abort the entire batch on
    // the first conflict, so we use a two-tier approach:
    //
    //   1. Try one bulk INSERT — fast path when no duplicates exist.
    //   2. On conflict (23505), fall back to per-row INSERT so good rows still
    //      land and we get accurate inserted / duplicate counts.
    let inserted = 0;
    let duplicates = 0;
    let otherErrors = 0;

    const bulk = await supabase.from("scholarly_documents").insert(rows);

    if (!bulk.error) {
      inserted = rows.length;
    } else if (bulk.error.code === "23505") {
      // Per-row fallback to skip only the duplicates
      for (const row of rows) {
        const r = await supabase.from("scholarly_documents").insert([row]);
        if (!r.error) inserted++;
        else if (r.error.code === "23505") duplicates++;
        else {
          otherErrors++;
          console.error("Row insert error:", r.error.message);
        }
      }
    } else {
      throw bulk.error;
    }

    return new Response(
      JSON.stringify({ ok: inserted, duplicates, errors: otherErrors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ingest-batch error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
