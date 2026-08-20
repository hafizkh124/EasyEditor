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

    // Row shape depends on mode: "check"/"insert" rows are full scholarly_documents
    // candidates (domain/source_type/content required), but "update-citation" rows
    // are {passage_key, source_url, citation_ref_patch} -- a different shape
    // entirely. This validation used to run unconditionally before the mode
    // branch below, so an update-citation payload always 400'd here before Part
    // E's citation-remap step could ever reach its own code path.
    if (mode === "update-citation") {
      for (const row of rows) {
        if (!row.passage_key || !row.source_url || !row.citation_ref_patch) {
          return new Response(
            JSON.stringify({ error: "Each update-citation row needs passage_key, source_url, citation_ref_patch" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } else if (mode === "lookup-citation") {
      for (const row of rows) {
        if (!row.collection || !row.hadith_number) {
          return new Response(
            JSON.stringify({ error: "Each lookup-citation row needs collection, hadith_number" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } else {
      for (const row of rows) {
        if (!row.domain || !row.source_type || !row.content) {
          return new Response(
            JSON.stringify({ error: "Each row needs domain, source_type, content" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // mode: "update-citation" — Phase E apply step. Patches citation_ref with
    // verified IUB deep-link fields and archives the prior source_url, via
    // scholarly_documents_update_citation (20260820000000_citation_remap_rpcs.sql).
    // Guarded by the same x-ingest-secret check as every other mode.
    if (mode === "update-citation") {
      const { data, error } = await supabase.rpc("scholarly_documents_update_citation", {
        payload: rows,
      });
      if (error) throw error;
      const updated = (data ?? []).filter((r: { updated: boolean }) => r.updated).length;
      return new Response(
        JSON.stringify({ processed: rows.length, updated, results: data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // mode: "lookup-citation" — Phase E alignment-probe read. For each
    // {collection, hadith_number}, returns the EXISTING row's own domain and
    // ar_fingerprint via scholarly_documents_lookup_by_citation (scoped exact
    // lookup, not a corpus-wide fingerprint search -- see that function's
    // comment in 20260820000000_citation_remap_rpcs.sql for why the
    // corpus-wide version this replaced gave meaningless results).
    if (mode === "lookup-citation") {
      const { data, error } = await supabase.rpc("scholarly_documents_lookup_by_citation", {
        payload: rows,
      });
      if (error) throw error;
      return new Response(
        JSON.stringify({ checked: rows.length, results: data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
