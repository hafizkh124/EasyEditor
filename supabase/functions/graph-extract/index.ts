import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { callChatCompletions } from "../_shared/aiGateway.ts";
// SPEC-M5 FR-1.5/FR-3.4: the extraction prompt + JSON schema live in shared/
// so the Electron main process's local knowledge-graph extraction uses the
// exact same schema this Deno function does.
import { GRAPH_EXTRACT_SYSTEM_PROMPT as SYSTEM_PROMPT } from "../_shared/mirror/ai/graphSchema.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// The model sometimes wraps JSON in ```json fences, or gets cut off by the
// token cap mid-array. Strip fences, then progressively trim back to the last
// complete object and close the brackets so a truncated response still yields
// the entities/relations that DID arrive instead of a hard 500.
// deno-lint-ignore no-explicit-any
function parseGraphJson(raw: string): any {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // ignore — attempt salvage below
  }

  for (let i = cleaned.length - 1; i > 0; i--) {
    const ch = cleaned[i];
    if (ch !== "}" ) continue;
    const head = cleaned.slice(0, i + 1);
    for (const tail of ["]}", "}]}", "]}}", ""]) {
      try {
        return JSON.parse(head + tail);
      } catch {
        // keep trying
      }
    }
  }

  console.warn("[graph-extract] unparseable AI output, returning empty graph");
  return { entities: [], relations: [] };
}

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Resolve user strictly from JWT token (NFR-5)
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { text, document_id, library_item_id } = body;

    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "Missing text parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Gemini 2.5 Flash to extract Knowledge Graph — routed through the
    // shared gateway like every other function (refine-text, queryPlanner),
    // which strips the "google/" prefix the native endpoint doesn't accept
    // and falls back to LOVABLE_API_KEY if Gemini itself is unavailable.
    // A prior direct-fetch version sent the prefixed model string straight to
    // Gemini's endpoint, which rejects it — extraction failed on every call.
    const aiRes = await callChatCompletions({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Passage to analyze:\n${text.slice(0, 6000)}` },
      ],
      response_format: { type: "json_object" },
      // 2048 was too small: long Urdu/Arabic passages produced output that hit
      // the cap mid-string, so JSON.parse threw "Unterminated string" and every
      // extraction 500'd. Give the model room, and salvage anyway if truncated.
      max_tokens: 8192,
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => "");
      console.error("[graph-extract] AI error:", aiRes.status, errText);
      return new Response(JSON.stringify({ error: "AI extraction failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const rawContent: string = aiData?.choices?.[0]?.message?.content || "{}";
    const extracted = parseGraphJson(rawContent);


    const rawEntities: Array<{
      canonical_name: string;
      kind: "person" | "concept" | "book" | "location" | "event";
      aliases?: string[];
      summary?: string;
    }> = Array.isArray(extracted?.entities) ? extracted.entities : [];

    const rawRelations: Array<{
      source_name: string;
      target_name: string;
      relation_type: string;
      evidence_quote?: string;
    }> = Array.isArray(extracted?.relations) ? extracted.relations : [];

    if (rawEntities.length === 0) {
      return new Response(JSON.stringify({ entities_count: 0, relations_count: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Upsert Entities into DB
    const entityRows = rawEntities.map((e) => ({
      user_id: userId,
      canonical_name: e.canonical_name.trim(),
      kind: e.kind,
      aliases: e.aliases || [],
      summary: e.summary || null,
    }));

    const { data: insertedEntities, error: entityErr } = await serviceClient
      .from("entities")
      .upsert(entityRows, { onConflict: "user_id,canonical_name" })
      .select("id, canonical_name");

    if (entityErr) {
      console.error("[graph-extract] entities upsert error:", entityErr);
      throw entityErr;
    }

    // Map canonical_name -> entity_id
    const entityIdMap = new Map<string, string>();
    for (const ent of insertedEntities || []) {
      entityIdMap.set(ent.canonical_name, ent.id);
    }

    // 2. Insert Relations into DB
    const relationRows = rawRelations
      .map((r) => {
        const sourceId = entityIdMap.get(r.source_name.trim());
        const targetId = entityIdMap.get(r.target_name.trim());
        if (!sourceId || !targetId || sourceId === targetId) return null;

        return {
          user_id: userId,
          source_entity_id: sourceId,
          target_entity_id: targetId,
          relation_type: r.relation_type,
          evidence_quote: r.evidence_quote || null,
          document_id: document_id || null,
          library_item_id: library_item_id || null,
        };
      })
      .filter(Boolean);

    let insertedRelationsCount = 0;
    if (relationRows.length > 0) {
      const { data: rels, error: relErr } = await serviceClient
        .from("entity_relations")
        .insert(relationRows)
        .select("id");

      if (!relErr && rels) {
        insertedRelationsCount = rels.length;
      }
    }

    return new Response(
      JSON.stringify({
        entities_count: entityRows.length,
        relations_count: insertedRelationsCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[graph-extract] exception:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

serve(handle);
