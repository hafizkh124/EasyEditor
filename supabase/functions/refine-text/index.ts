import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";

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

  spelling_check: `You are a precise spelling and orthography corrector. Your ONLY job is to correct spelling mistakes in the user's text.

HARD RULES:
1. Do NOT rephrase, restructure, translate, summarize, expand, or reformat the text.
2. Preserve the original wording, grammar style, punctuation, line breaks, capitalization (except when fixing a spelling error that requires case change), and script (Urdu stays Urdu, English stays English, Arabic stays Arabic).
3. Only change tokens that are genuine spelling errors. When unsure, leave the token unchanged.
4. Support Urdu, English, and Arabic spelling conventions. Use standard modern orthography for each.
5. Output ONLY the corrected text — no JSON, no Markdown fences, no commentary before or after. If there are no corrections, output the original text unchanged.`,

  normalize_script: `You are a script normalization assistant. Your ONLY job is to make the text use a single consistent script throughout.

PROCEDURE:
1. Detect the DOMINANT script of the input text. Options: Urdu Nastaliq (Arabic alphabet used for Urdu), English Latin, Arabic.
2. Convert any segments written in a different script into the dominant script, preserving meaning exactly:
   - If dominant is Urdu Nastaliq: rewrite Roman-Urdu segments (Latin letters spelling Urdu words like "Allah hamein hidayat de") into Urdu script ("اللہ ہمیں ہدایت دے"). Rewrite Devanagari (Hindi) segments into equivalent Urdu Nastaliq. Transliterate isolated English loanwords (like "school", "mobile") into Urdu script ("اسکول", "موبائل").
   - If dominant is English Latin: rewrite stray Urdu / Arabic / Devanagari words into appropriate English — transliterate proper nouns, translate common words. Keep meaning intact.
   - If dominant is Arabic: keep Arabic; transliterate or translate non-Arabic segments into Arabic appropriately.
3. Do NOT paraphrase, rephrase, summarize, expand, or "improve" the text. Wording, sentence order, punctuation, and line breaks must be preserved.
4. Do NOT correct spelling errors — that is a different tool. Only fix script inconsistencies.
5. Output ONLY the normalized text — no commentary, no markdown, no explanations.`,

  add_harakat: `You are an expert in Arabic and Urdu orthography (تشکیل / اِعراب). Your ONLY job is to add full, correct diacritics (harakat) to the user's text.

HARD RULES:
1. Add fatha, kasra, damma, shadda, sukun, tanwin, and any other appropriate diacritics so the text is fully voweled and unambiguous to read.
2. Do NOT change, add, remove, reorder, translate, or rephrase any base letters or words. Only ADD diacritic marks above/below existing letters.
3. Preserve all punctuation, line breaks, spacing, and the original script (Arabic stays Arabic, Urdu stays Urdu).
4. For Quranic verses, use the standard mushaf tashkeel. For Urdu, use conventional Urdu اِعراب.
5. Output ONLY the diacritized text — no commentary, no markdown fences, no explanations.`,

  paraphrase: `You are a skilled editor. Reword the following text so it expresses the SAME meaning in different words.

HARD RULES:
1. Preserve the original meaning, intent, and all factual content — do not add, omit, or distort information.
2. Keep the SAME language and script as the input (Urdu stays Urdu Nastaliq, Arabic stays Arabic, English stays English). Never translate.
3. Preserve any existing diacritics (harakat) on Arabic/Urdu words.
4. Quoted Quranic verses or hadith text inside quotation marks must be kept VERBATIM — paraphrase only the surrounding prose.
5. Keep a similar length and the same level of formality as the original.
6. Output ONLY the paraphrased text — no commentary, no markdown fences, no explanations.`,

  summarize: `You are an expert summarizer. Produce a clear, coherent summary of the following text.

HARD RULES:
1. Capture the main ideas and key points faithfully; do not invent or add information not present in the source.
2. Write the summary in the SAME language and script as the input (Urdu stays Urdu Nastaliq, Arabic stays Arabic, English stays English). Never translate.
3. Aim for roughly 20–30% of the original length, as flowing prose (use short paragraphs; bullet points only if the source is clearly a list).
4. Do NOT quote Quranic verses or hadith from memory; only reference them as they appear in the source.
5. Output ONLY the summary text — no commentary, no markdown fences, no preamble like "Summary:".`,

  auto_format: `You are a professional document formatter. Convert the user's raw text into clean, well-structured semantic HTML.

RULES:
1. Output VALID HTML fragment only (no <html>, <head>, or <body> wrapper, no markdown fences, no commentary).
2. Use appropriate tags: <h1>/<h2>/<h3> for headings, <p> for paragraphs, <ul>/<ol>/<li> for lists, <blockquote> for quotations, <strong>/<em> for emphasis.
3. Infer structure from the content: titles become headings, enumerated points become lists, quoted material becomes blockquotes.
4. Do NOT change, translate, summarize, expand, or rephrase the wording. Preserve the original language and script exactly (Urdu stays Urdu, Arabic stays Arabic, English stays English).
5. Preserve right-to-left text as-is; do not add dir attributes.
6. Output ONLY the HTML.`,
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

    // Token-based quota check: 5 tokens per refinement action
    const tokenCost = calculateCost("refine", 1);
    const tokenResult = await checkAndDeductTokens(
      supabase, user.id, tokenCost, "refine",
      `${action} refinement`,
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
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
      // Refund tokens on AI failure
      await refundTokens(supabase, user.id, tokenCost, "refine", "AI gateway error");

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

    return new Response(JSON.stringify({ text: refined, tokens_used: tokenCost }), {
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
