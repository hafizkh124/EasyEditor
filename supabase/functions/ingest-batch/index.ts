import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Rows per database statement. Callers still POST up to 500 rows per request
// (that cap is unchanged), but the work is split into this many rows per
// statement so no single statement runs long enough to hit statement_timeout
// and return 57014, which previously failed the entire batch.
const CHUNK = 100;


/**
 * Exported so the request logic is reachable from a test. Everything below
 * used to live inside an anonymous `serve(async (req) => …)`, which left the
 * HTTP layer — validation, auth rejection, error mapping, CORS on error
 * responses — verifiable only by the post-deploy smoke script.
 */
export async function handle(req: Request): Promise<Response> {
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
    } else if (mode === "update-content") {
      for (const row of rows) {
        // citation_ref_patch is optional here (unlike update-citation): a
        // caller may be fixing only the text. A blank content is rejected
        // rather than treated as "clear the field" — see the RPC's own guard.
        if (!row.passage_key || typeof row.content !== "string" || row.content.trim() === "") {
          return new Response(
            JSON.stringify({ error: "Each update-content row needs passage_key and a non-empty content" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } else if (mode === "delete-by-scope") {
      // A single scope spec, not a list of rows -- but reuses the {rows,
      // mode} envelope (as one-element array) rather than a new top-level
      // field, so this mode needs no new branch in the request parsing above.
      if (rows.length !== 1 || !rows[0].domain || !Array.isArray(rows[0].collections) || rows[0].collections.length === 0) {
        return new Response(
          JSON.stringify({ error: "delete-by-scope needs exactly one row: { domain, collections: [non-empty] }" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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

    // mode: "update-content" — in-place content fix via
    // scholarly_documents_update_content (20260823200000_update_content_rpc.sql).
    // Separate from update-citation because that RPC can only reach
    // citation_ref and source_url: when a scraper extracted the wrong TEXT
    // (rijal rows were missing their per-book narration counts entirely), the
    // column that has to change is `content`, which is also the only field the
    // model ever reads. Chunked for the same statement_timeout reason as
    // "check" below. Guarded by the same x-ingest-secret check as every mode.
    if (mode === "update-content") {
      const results: unknown[] = [];
      let updated = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { data, error } = await supabase.rpc("scholarly_documents_update_content", {
          payload: rows.slice(i, i + CHUNK),
        });
        if (error) throw error;
        const chunkResults = (data ?? []) as { updated: boolean }[];
        updated += chunkResults.filter((r) => r.updated).length;
        results.push(...chunkResults);
      }
      return new Response(
        JSON.stringify({ processed: rows.length, updated, results }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // mode: "delete-by-scope" — scoped DELETE via
    // scholarly_documents_delete_by_scope (20260823210000_delete_by_scope_rpc.sql).
    // Built for retiring tohed-hadith rows once a domain carrying real Arabic
    // matn supersedes them (2026-08-23 IUB Arabic-gap backfill). NOT chunked
    // like the other modes -- it is one DELETE statement scoped by
    // (domain, collection[]), not a list of individual rows, so there is
    // nothing to chunk. Guarded by the same x-ingest-secret check as every
    // mode; the RPC itself refuses an empty collections array so this can
    // never be turned into "delete an entire domain" by a missing argument.
    if (mode === "delete-by-scope") {
      const { domain, collections } = rows[0];
      const { data, error } = await supabase.rpc("scholarly_documents_delete_by_scope", {
        p_domain: domain,
        p_collections: collections,
      });
      if (error) throw error;
      return new Response(
        JSON.stringify({ deleted: (data ?? []).length, results: data }),
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
    //
    // Sub-chunked: the RPC is ONE statement that loops over every row it is
    // given, doing several indexed EXISTS lookups each. At 500 rows that
    // single statement routinely ran past the session statement_timeout and
    // came back as 57014, failing the whole batch. Splitting into CHUNK-sized
    // RPC calls keeps each statement short, so a slow patch of rows can no
    // longer take the entire batch down. (service_role's timeout was also
    // raised from the inherited 8s to 120s -- belt and braces.)
    if (mode === "check") {
      const results: unknown[] = [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { data, error } = await supabase.rpc("scholarly_documents_check_batch", {
          payload: rows.slice(i, i + CHUNK),
        });
        if (error) throw error;
        results.push(...(data ?? []));
      }
      return new Response(
        JSON.stringify({ checked: rows.length, results }),
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
    //   1. Try one bulk INSERT per CHUNK — fast path when no duplicates exist.
    //   2. On conflict (23505), fall back to per-row INSERT so good rows still
    //      land and we get accurate inserted / duplicate counts.
    //
    // The insert is chunked for the same reason as the check RPC above: a
    // single 500-row INSERT against a table carrying ~19 indexes (including
    // an ivfflat vector index) was another 57014 source.
    let inserted = 0;
    let duplicates = 0;
    let otherErrors = 0;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const bulk = await supabase.from("scholarly_documents").insert(chunk);

      if (!bulk.error) {
        inserted += chunk.length;
      } else if (bulk.error.code === "23505") {
        // Per-row fallback to skip only the duplicates
        for (const row of chunk) {
          const r = await supabase.from("scholarly_documents").insert([row]);
          if (!r.error) inserted++;
          else if (r.error.code === "23505") duplicates++;
          else {
            otherErrors++;
            console.error("Row insert error:", r.error.message);
          }
        }
      } else if (bulk.error.code === "57014") {
        // Statement timeout on the chunk: retry row-by-row rather than
        // failing the whole request, so a single slow row cannot discard
        // the other 99.
        console.error(`Chunk at ${i} timed out; retrying row-by-row`);
        for (const row of chunk) {
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
    }


    return new Response(
      JSON.stringify({ ok: inserted, duplicates, errors: otherErrors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ingest-batch error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

Deno.serve(handle);
