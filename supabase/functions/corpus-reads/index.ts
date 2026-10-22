import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAdminUser } from "../_shared/tokenGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * A few fixed, read-only lookups on tables the browser can no longer read
 * directly (scholarly_documents, passage_translations, translators,
 * api_response_cache — their "any signed-in user" read policies were dropped,
 * so only the server may read them). Each action is one narrow query with
 * validated input; nothing here accepts a table name, a column or a filter
 * from the caller.
 *
 *   passage-translations  { passageKey: "quran:2:255", language: "ur" }
 *   narrator-names        { rawyIds: [number, ...] }   (at most 100)
 *   cache-count           {}                            (admins only)
 *
 * Exported so the request logic is reachable from a test.
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    switch (body.action) {
      case "passage-translations": {
        const passageKey = String(body.passageKey ?? "");
        const language = String(body.language ?? "");
        if (!/^quran:\d{1,3}:\d{1,3}$/.test(passageKey)) return json({ error: "passageKey must look like quran:2:255" }, 400);
        if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) return json({ error: "invalid language" }, 400);
        const { data, error } = await supabase
          .from("passage_translations")
          .select("passage_key, translator_slug, text, translators(full_name)")
          .eq("passage_key", passageKey)
          .eq("language", language)
          .limit(5);
        if (error) throw error;
        return json({ rows: data ?? [] });
      }

      case "narrator-names": {
        const ids = Array.isArray(body.rawyIds) ? body.rawyIds : [];
        const rawyIds = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100);
        if (rawyIds.length === 0) return json({ rows: [] });
        const { data, error } = await supabase
          .from("scholarly_documents")
          .select("citation_ref, source_url, title")
          .eq("domain", "islamicurdubooks-rijal")
          .in("citation_ref->>rawy_id", rawyIds.map(String))
          .limit(rawyIds.length * 2);
        if (error) throw error;
        return json({ rows: data ?? [] });
      }

      case "cache-count": {
        if (!(await isAdminUser(supabase, user.id))) return json({ error: "Forbidden" }, 403);
        const { count, error } = await supabase
          .from("api_response_cache")
          .select("cache_key", { count: "exact", head: true });
        if (error) throw error;
        return json({ count: count ?? 0 });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("corpus-reads error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}

serve(handle);
