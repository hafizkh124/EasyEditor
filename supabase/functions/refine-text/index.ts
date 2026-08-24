import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";
import { callChatCompletions } from "../_shared/aiGateway.ts";
import { findCitations, evaluateKifayatGate, type EngineCitation } from "../_shared/citationEngine.ts";
import { buildRetrievalQuery, perSourceBudget } from "../_shared/retrievalQuery.ts";
// SPEC-M5 FR-1.5/FR-3.4: the action prompts live in shared/ so the Electron
// main process's local refine-text equivalent uses the exact same wording
// this Deno function does, rather than a hand-maintained second copy.
import { REFINE_TEXT_ACTIONS as actionPrompts } from "../_shared/mirror/ai/prompts/refineText.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Build a citations-with-Islamic-sources prompt using retrieved RAG context ──
//
// The model is deliberately NOT asked to type out the reference text itself
// (title, hadith number, narrator, grade). Earlier versions asked it to
// paraphrase that from the numbered CURATED ISLAMIC SOURCES block below —
// but a model retyping a citation from context can drift from the source it
// is attached to (the same failure independently found in islamic-search's
// answer citations: inline text saying one hadith number, the references
// list saying another, because both were separately hand-typed from the
// same context). Here the model only picks WHICH numbered sources are
// relevant; the client (rebuildCitedRefinement in
// src/lib/editor/citationFormat.ts) renders each one from the verified
// `sources` array this function returns alongside `text`, using the exact
// [N] markers the model wrote as the only thing it's allowed to get wrong
// harmlessly (an out-of-range or malformed index is just dropped).
function buildIslamicCitationsPrompt(contextBlock: string): string {
  return `You are an Islamic research assistant. The user has provided a piece of text (transcribed speech, lecture, or notes).
Your task:
1. Keep the user's original text COMPLETELY UNCHANGED at the top.
2. After the original text, add a line "---" then a heading "## حوالہ جات / Sources".
3. Under that heading, list ONLY the bracketed numbers — [N] — of the 3–6 MOST RELEVANT sources from CURATED ISLAMIC SOURCES below, one per line, most relevant first. Example:
[2]
[5]
[1]
4. Do NOT write the source's title, hadith number, narrator, grade, or any other citation text yourself, and do NOT include a URL — the app renders the verified reference for each number you list. A hand-typed citation can silently disagree with the source it names.
5. If no curated source is relevant, write a brief note in the user's language that no matching authentic source was found, and list no numbers.

Format:

[ORIGINAL TEXT — verbatim]

---

## حوالہ جات / Sources
[2]
[5]
[1]

CURATED ISLAMIC SOURCES (numbered — pick ONLY from these numbers):
${contextBlock}`;
}

/** A source as the client's Trust UI consumes it. */
interface TrustSource {
  domain: string;
  reference: string;
  /** Structured ref, so the client can reuse its existing CitationBadge. */
  // deno-lint-ignore no-explicit-any
  citation_ref: Record<string, any>;
  source_url: string | null;
  snippet: string;
  score: number;
  channels: string[];
}

function formatReference(m: EngineCitation): string {
  const cite = m.citation_ref ?? {};
  if (cite.collection || cite.book) {
    return `${cite.collection ?? cite.book}${cite.hadith_number ? ` #${cite.hadith_number}` : ""}${cite.grade ? ` (${cite.grade})` : ""}`;
  }
  if (cite.surah_name) {
    return `Quran ${cite.surah_name} ${cite.surah_number ?? ""}:${cite.verse ?? ""}`;
  }
  return cite.title || m.domain;
}

interface IslamicContext {
  contextBlock: string;
  sources: TrustSource[];
  confidence: number | null;
}

async function fetchIslamicContext(
  supabase: any,
  text: string,
  userId: string,
): Promise<IslamicContext> {
  // Retrieval goes through the shared citation engine (plan → lexical +
  // semantic → RRF), the same path the Editor's reference search uses.
  //
  // This used to be a lone pgvector lookup that embedded with the retired
  // "text-embedding-004" while the corpus was embedded with
  // gemini-embedding-001 — different vector space, so similarity was
  // meaningless and this feature returned "no sources found" essentially
  // always. See _shared/embed.ts.
  //
  // rerank is off: the caller immediately makes its own LLM call to write the
  // citations section, and a second ranking pass isn't worth the extra
  // latency on what is already a long text-refinement request.
  try {
    const result = await findCitations({
      query: buildRetrievalQuery(text),
      supabase,
      userId,
      maxResults: 8,
      rerank: false,
    });

    if (result.results.length === 0) {
      return {
        contextBlock: "[No matching curated Islamic sources were found for this text.]",
        sources: [],
        confidence: 0,
      };
    }

    const budget = perSourceBudget(result.results.length);

    const contextBlock = result.results
      .map((m, i) => {
        const ref = formatReference(m);
        // Only emit a URL when the corpus actually has one — the prompt
        // forbids the model from inventing links, so give it nothing to
        // complete when the source is URL-less.
        const url = m.source_url || m.citation_ref?.url || "";
        return `Source ${i + 1} [${m.domain}] — ${ref}${url ? ` (${url})` : ""}\n${(m.content_ar || m.content || "").slice(0, budget)}`;
      })
      .join("\n\n");

    // Reuse the engine's own retrieval-confidence proxy rather than inventing a
    // second number the rest of the system would have to reconcile.
    const gate = evaluateKifayatGate(result.results);

    const sources: TrustSource[] = result.results.map((m) => ({
      domain: m.domain,
      reference: formatReference(m),
      citation_ref: m.citation_ref ?? {},
      // Never synthesise a link: the Trust UI renders these as citations, and a
      // fabricated URL is exactly the failure this surface exists to prevent.
      source_url: m.source_url || m.citation_ref?.url || null,
      snippet: (m.content_ar || m.content || "").slice(0, 300),
      score: m.score,
      channels: m.channels ?? [],
    }));

    return { contextBlock, sources, confidence: gate.maxScore };
  } catch (e) {
    console.warn("[refine-text/citations] retrieval error:", e);
    return {
      contextBlock: "[No curated sources retrieved — retrieval error.]",
      sources: [],
      confidence: null,
    };
  }
}

/**
 * Exported so the request logic is reachable from a test. Everything below
 * used to live inside an anonymous `serve(async (req) => …)`, which left the
 * HTTP layer — validation, auth rejection, error mapping, CORS on error
 * responses — verifiable only by the post-deploy smoke script.
 */
export async function handle(req: Request): Promise<Response> {
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

    const { text, action, task_id: taskId } = await req.json();

    // A custom task supplies its prompt by ID only. The prompt text itself is
    // NEVER read from the request body: this function runs on the service-role
    // key, so honouring a caller-supplied system prompt would turn it into an
    // open LLM proxy billed to whoever's token it was called with
    // (SPEC-M3 FR-2.5 / R10).
    let customPrompt: string | null = null;
    if (taskId) {
      const { data: customTask, error: customErr } = await supabase
        .from("ai_tasks")
        .select("system_prompt, base_task_slug, archived_at")
        .eq("id", taskId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (customErr || !customTask || customTask.archived_at) {
        return new Response(JSON.stringify({ error: "یہ ٹاسک دستیاب نہیں ہے۔" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      customPrompt = customTask.system_prompt;
    }

    const isCitations = action === "citations";
    if (!text || (!customPrompt && (!action || (!isCitations && !actionPrompts[action])))) {
      return new Response(JSON.stringify({ error: "Invalid request. Provide text and a valid action." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FR-9.3 Payload size limit guard (12,000 chars)
    if (typeof text === "string" && text.length > 12000) {
      return new Response(
        JSON.stringify({ error: "دستاویز بڑی ہے — متن منتخب کریں، یا حصہ بہ حصہ چلائیں۔" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // FR-9.5 Token-based quota check: 5 tokens per ~2,000 characters
    const multiplier = Math.max(1, Math.ceil(text.length / 2000));
    const tokenCost = calculateCost("refine", multiplier);
    const tokenResult = await checkAndDeductTokens(
      supabase, user.id, tokenCost, "refine",
      `${action} refinement (${multiplier}x)`,
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
    }

    const hasAnyKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("LOVABLE_API_KEY");
    if (!hasAnyKey) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build system prompt — for citations, retrieve Islamic context first
    let systemPrompt: string;
    let sources: TrustSource[] = [];
    // `null` means "this action does not produce a confidence" — a spell-check
    // must report nothing rather than a made-up certainty (SPEC-M3 FR-4.4).
    let confidence: number | null = null;

    if (customPrompt) {
      // A custom task is a preset over the same pipeline, never its own path.
      systemPrompt = customPrompt;
    } else if (isCitations) {
      const ctx = await fetchIslamicContext(supabase, text, user.id);
      systemPrompt = buildIslamicCitationsPrompt(ctx.contextBlock);
      sources = ctx.sources;
      confidence = ctx.confidence;
    } else {
      systemPrompt = actionPrompts[action];
    }

    const model = isCitations ? "google/gemini-2.5-flash" : "google/gemini-3-flash-preview";

    const aiResponse = await callChatCompletions({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
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

    // Additive response (SPEC-M3 FR-4.1 / NFR-7): `text` and `tokens_used` keep
    // their old meaning, so clients built before M3 are unaffected. Edge
    // functions cannot sit behind a feature flag, hence the strict additivity.
    return new Response(
      JSON.stringify({
        text: refined,
        tokens_used: tokenCost,
        sources,
        confidence,
        model,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("refine-text error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

serve(handle);
