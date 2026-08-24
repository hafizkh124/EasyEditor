import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";
import { callChatCompletions } from "../_shared/aiGateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    // Get user from auth header
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

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 10 transcriptions per user per minute
    if (isRateLimited(user.id, 10, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    // Check subscription exists
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("tier, transcription_seconds_used, transcription_limit")
      .eq("user_id", user.id)
      .single();

    if (!sub) {
      return new Response(JSON.stringify({ error: "No subscription found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { audio, language, duration } = await req.json();

    // SPEC-v2 FR-3.1: hard cap on per-call duration. Long-form transcription is
    // chunked client-side into ~5-minute slices, so any single call should be
    // well under this limit; reject obvious abuse.
    const MAX_CALL_DURATION_SECONDS = 600; // 10 minutes per chunk, generous headroom over the 5-min target
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > MAX_CALL_DURATION_SECONDS) {
      return new Response(
        JSON.stringify({ error: `Invalid duration. Each request must be between 1 and ${MAX_CALL_DURATION_SECONDS} seconds.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Token-based quota check: 10 tokens per minute (round up)
    const tokenCost = calculateCost("stt", Math.ceil(duration / 60));
    const tokenResult = await checkAndDeductTokens(
      supabase, user.id, tokenCost, "stt",
      `${(duration / 60).toFixed(1)} min transcription`,
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
    }

    // Call Lovable AI Gateway to refine/process the audio transcription
    // AI provider key check (Gemini-direct primary, Lovable fallback inside helper)
    const hasAnyKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("LOVABLE_API_KEY");
    if (!hasAnyKey) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Language configuration map ──────────────────────────────────────
    const LANG_CONFIG: Record<string, { name: string; scriptRules: string }> = {
      "en-US": {
        name: "English",
        scriptRules: `SCRIPT RULES (STRICT):
1. The ENTIRE output MUST be in standard Latin (English) script.
2. If a small portion of the audio is genuinely in Urdu/Arabic (a quoted verse, a name in Urdu), you may keep that brief portion in its original script — but English speech that contains Arabic-origin loanwords should still be written in English.`,
      },
      "ur-PK": {
        name: "Urdu",
        scriptRules: `SCRIPT RULES (STRICT — non-negotiable):
1. The ENTIRE output MUST be in Urdu Nastaliq (Arabic) script. Every single character.
2. Do NOT output Roman Urdu (Latin/English letters used to write Urdu words). FORBIDDEN.
3. Do NOT output Devanagari (Hindi) script. FORBIDDEN.
4. If you hear an English or Hindi loanword inside Urdu speech (e.g., "school", "mobile", "computer"), TRANSLITERATE it into Urdu script — e.g., write "اسکول" not "school", write "موبائل" not "mobile", write "کمپیوٹر" not "computer". Never leave Latin letters in the output.
5. If a small portion of the audio is genuinely in English (a quoted sentence, a name read in English), you may keep that brief portion in Latin script — but Urdu speech that merely contains English-origin words must still be written in Urdu script.`,
      },
      ar: {
        name: "Arabic",
        scriptRules: `SCRIPT RULES (STRICT — non-negotiable):
1. The ENTIRE output MUST be in Arabic script.
2. Use Modern Standard Arabic script and spelling conventions.
3. If you hear an English loanword, TRANSLITERATE it into Arabic script (e.g., "computer" → "كمبيوتر"). Never leave Latin letters in the output.
4. If a small portion of the audio is genuinely in English (a quoted sentence, a name), you may keep that brief portion in Latin script.`,
      },
      pa: {
        name: "Punjabi",
        scriptRules: `SCRIPT RULES (STRICT — non-negotiable):
1. The ENTIRE output MUST be in Shahmukhi (Arabic-script Punjabi). Every single character.
2. Do NOT use Gurmukhi script. FORBIDDEN.
3. Do NOT output Roman Punjabi (Latin letters). FORBIDDEN.
4. If you hear an English loanword, TRANSLITERATE it into Shahmukhi script.
5. Use standard Shahmukhi orthographic conventions with proper ا، ب، پ، ت، ٹ characters.
6. If a small portion of the audio is genuinely in English, you may keep that brief portion in Latin script.`,
      },
      ps: {
        name: "Pashto",
        scriptRules: `SCRIPT RULES (STRICT — non-negotiable):
1. The ENTIRE output MUST be in Pashto Arabic script.
2. Use proper Pashto-specific characters: ټ، ډ، ړ، ږ، ښ، ځ، څ، ۍ، ې.
3. Do NOT output Roman Pashto (Latin letters). FORBIDDEN.
4. If you hear an English loanword, TRANSLITERATE it into Pashto script.
5. If a small portion of the audio is genuinely in English, you may keep that brief portion in Latin script.`,
      },
      fa: {
        name: "Persian",
        scriptRules: `SCRIPT RULES (STRICT — non-negotiable):
1. The ENTIRE output MUST be in Persian Arabic script (Farsi script).
2. Use proper Persian-specific characters: گ، چ، پ، ژ.
3. Do NOT output Finglish/Roman Persian (Latin letters). FORBIDDEN.
4. If you hear an English loanword, TRANSLITERATE it into Persian script (e.g., "computer" → "کامپیوتر").
5. If a small portion of the audio is genuinely in English, you may keep that brief portion in Latin script.`,
      },
      sd: {
        name: "Sindhi",
        scriptRules: `SCRIPT RULES (STRICT — non-negotiable):
1. The ENTIRE output MUST be in Sindhi Arabic script.
2. Use proper Sindhi-specific characters: ٻ، ٽ، ٿ، ڄ، ڃ، ڇ، ڊ، ڌ، ڏ، ڳ، ڱ، ڻ.
3. Do NOT output Roman Sindhi (Latin letters). FORBIDDEN.
4. If you hear an English loanword, TRANSLITERATE it into Sindhi script.
5. If a small portion of the audio is genuinely in English, you may keep that brief portion in Latin script.`,
      },
      bal: {
        name: "Balochi",
        scriptRules: `SCRIPT RULES (STRICT — non-negotiable):
1. The ENTIRE output MUST be in Balochi Arabic script.
2. Use standard Balochi orthography with Arabic-script conventions.
3. Do NOT output Roman Balochi (Latin letters). FORBIDDEN.
4. If you hear an English loanword, TRANSLITERATE it into Balochi Arabic script.
5. If a small portion of the audio is genuinely in English, you may keep that brief portion in Latin script.`,
      },
    };

    const isAuto = !language || language === "auto";
    const langConfig = LANG_CONFIG[language as string];
    const langName = isAuto ? "auto-detected" : langConfig?.name ?? language;

    const scriptRules = isAuto
      ? `SCRIPT RULES (STRICT — non-negotiable):
1. Auto-detect the spoken language from the audio (it may be Urdu, English, Arabic, Punjabi, Pashto, Persian, Sindhi, Balochi, or another language).
2. Transcribe in the NATIVE script of the detected language:
   - Urdu → Urdu Nastaliq (Arabic) script. NEVER Roman Urdu or Devanagari.
   - Arabic → Arabic script.
   - English → standard Latin script.
   - Punjabi → Shahmukhi (Arabic script). NEVER Gurmukhi.
   - Pashto → Pashto Arabic script with proper ټ ډ ړ ږ characters.
   - Persian → Persian Arabic script with proper گ چ پ ژ characters.
   - Sindhi → Sindhi Arabic script with proper ٻ ٽ ٿ characters.
   - Balochi → Balochi Arabic script.
   - Any other language → its standard native script.
3. If the audio mixes languages, write each portion in its own native script.
4. Transliterate English loanwords into the detected language's script.`
      : langConfig?.scriptRules ?? `SCRIPT RULES: Transcribe in ${langName}.`;

    const systemPrompt = isAuto
      ? `You are a speech transcription assistant. The user has recorded audio in an unspecified language.
Detect the spoken language and transcribe it accurately in that language's native script.

${scriptRules}

Only output the transcription text, nothing else — no introductions, no explanations, no markdown, no language labels.`
      : `You are a speech transcription assistant. The user has recorded audio in ${langName}.
You will receive a base64-encoded audio file. Transcribe it accurately in ${langName}.

${scriptRules}

Only output the transcription text, nothing else — no introductions, no explanations, no markdown.`;

    const aiResponse = await callChatCompletions({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: isAuto ? "Detect the spoken language and transcribe this audio accurately in its native script:" : `Transcribe this audio recording accurately in ${langName}:` },
            { type: "image_url", image_url: { url: audio } },
          ],
        },
      ],
    });

    if (!aiResponse.ok) {
      // Refund tokens on AI failure
      await refundTokens(supabase, user.id, tokenCost, "stt", "AI gateway error");

      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "Transcription service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const text = aiData.choices?.[0]?.message?.content || "";

    // Update legacy usage counter (backward compat analytics)
    supabase
      .from("subscriptions")
      .update({
        transcription_seconds_used: sub.transcription_seconds_used + duration,
      })
      .eq("user_id", user.id)
      .then(() => {});

    return new Response(JSON.stringify({ text, tokens_used: tokenCost }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("transcribe error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

serve(handle);
