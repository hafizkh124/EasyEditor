import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const actionPrompts: Record<string, string> = {
  formalize: `You are a professional editor. Rewrite the following text in a formal, academic, and professional tone. 
Maintain the original language (if Urdu, respond in Urdu script; if English, respond in English). 
Preserve the core meaning. Only output the refined text.`,

  humanize: `You are a friendly editor. Rewrite the following text in a warm, conversational, and natural tone. 
Maintain the original language (if Urdu, respond in Urdu script; if English, respond in English). 
Preserve the core meaning. Only output the refined text.`,

  shorten: `You are a concise editor. Condense the following text into a brief summary capturing all key points. 
Maintain the original language (if Urdu, respond in Urdu script; if English, respond in English). 
Only output the shortened text.`,
};

// ── Build a citations-with-Islamic-sources prompt using retrieved RAG context ──
function buildIslamicCitationsPrompt(contextBlock: string): string {
  return `You are an Islamic research assistant. The user has provided a piece of text (transcribed speech, lecture, or notes).
Your task:
1. Keep the user's original text COMPLETELY UNCHANGED at the top.
2. After the original text, append a section titled "حوالہ جات / Sources" containing 3–6 RELEVANT references chosen ONLY from the curated Islamic sources provided below.
3. NEVER invent, paraphrase, or fabricate a hadith, Quran verse, fatwa, or scholarly citation. If no curated source is relevant, write a brief note that no matching authentic source was found and DO NOT add any citation.
4. For each citation, include: short title, narrator/scholar/surah info, and the source URL if available.
5. Maintain the original language of the user's text. Section heading may be bilingual.

Format:

[ORIGINAL TEXT — verbatim]

---

## حوالہ جات / Sources
1. [Title or hadith/verse reference] — short context. ([source link](URL))
2. ...

CURATED ISLAMIC SOURCES (use ONLY these):
${contextBlock}`;
}

async function fetchIslamicContext(
  supabase: any,
  text: string,
  lovableKey: string,
): Promise<string> {
  // 1. Embed the text via Lovable AI gateway (use a small embedding model if available, otherwise fall back)
  // The project already uses match_scholarly_documents elsewhere; we keep it simple here.
  try {
    const embedResp = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/text-embedding-004",
        input: text.slice(0, 4000),
      }),
    });

    if (!embedResp.ok) {
      console.warn("[refine-text/citations] embedding failed:", embedResp.status);
      return "[No curated sources retrieved — embedding service unavailable.]";
    }

    const embedData = await embedResp.json();
    const embedding = embedData?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      return "[No curated sources retrieved — invalid embedding response.]";
    }

    // 2. Match against curated Islamic scholarly documents
    const { data: matches, error } = await (supabase.rpc as any)("match_scholarly_documents", {
      query_embedding: embedding,
      match_threshold: 0.5,
      match_count: 8,
    });

    if (error || !Array.isArray(matches) || matches.length === 0) {
      return "[No matching curated Islamic sources were found for this text.]";
    }

    // 3. Format compact context block for the model
    return matches
      .map((m: any, i: number) => {
        const cite = m.citation_ref ?? {};
        const ref =
          cite.collection || cite.book
            ? `${cite.collection ?? cite.book}${cite.hadith_number ? ` #${cite.hadith_number}` : ""}${cite.grade ? ` (${cite.grade})` : ""}`
            : cite.surah_name
            ? `Quran ${cite.surah_name} ${cite.surah_number ?? ""}:${cite.verse ?? ""}`
            : cite.title || m.title || m.domain;
        const url = m.source_url || cite.url || "";
        return `Source ${i + 1} [${m.domain}] — ${ref}${url ? ` (${url})` : ""}\n${(m.content ?? "").slice(0, 600)}`;
      })
      .join("\n\n");
  } catch (e) {
    console.warn("[refine-text/citations] retrieval error:", e);
    return "[No curated sources retrieved — retrieval error.]";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 30 refinements per user per minute
    if (isRateLimited(user.id, 30, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    const { text, action } = await req.json();

    const isCitations = action === "citations";
    if (!text || !action || (!isCitations && !actionPrompts[action])) {
      return new Response(JSON.stringify({ error: "Invalid request. Provide text and a valid action." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build system prompt — for citations, retrieve Islamic context first
    let systemPrompt: string;
    if (isCitations) {
      const contextBlock = await fetchIslamicContext(supabase, text, LOVABLE_API_KEY);
      systemPrompt = buildIslamicCitationsPrompt(contextBlock);
    } else {
      systemPrompt = actionPrompts[action];
    }

    const model = isCitations ? "google/gemini-2.5-flash" : "google/gemini-3-flash-preview";

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI refinement failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const refined = aiData.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ text: refined }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("refine-text error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
