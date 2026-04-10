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
    // SECURITY: Use a shared secret for ingest authorization
    // instead of exposing the service role key to the client.
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
    
    // Internal client uses service role key for DB operations
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

    // Protection against overly large payloads
    if (rows.length > 500) {
      return new Response(JSON.stringify({ error: "Max 500 rows per batch" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate required fields
    for (const row of rows) {
      if (!row.domain || !row.source_type || !row.content) {
        return new Response(
          JSON.stringify({ error: "Each row needs domain, source_type, content" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let result;
    if (mode === "upsert") {
      // For resume mode: upsert based on domain + source_type + title
      result = await supabase
        .from("scholarly_documents")
        .upsert(rows, { onConflict: "domain,source_type,title" });
    } else {
      result = await supabase
        .from("scholarly_documents")
        .insert(rows);
    }

    if (result.error) {
      // If duplicate conflict, return partial success (200) or error
      if (result.error.code === "23505") {
        return new Response(
          JSON.stringify({ ok: 0, duplicates: rows.length, error: result.error.message }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw result.error;
    }

    return new Response(
      JSON.stringify({ ok: rows.length, duplicates: 0 }),
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
