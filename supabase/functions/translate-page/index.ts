import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";
import { callChatCompletions } from "../_shared/aiGateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    if (isRateLimited(userId, 10, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    const { text, imageBase64, mimeType, targetLanguage, sourceLanguage } = await req.json();

    if (!text && !imageBase64) {
      return new Response(
        JSON.stringify({ error: "Provide either text or imageBase64" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!targetLanguage) {
      return new Response(
        JSON.stringify({ error: "targetLanguage is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tokenCost = calculateCost("translate", 1);
    const tokenResult = await checkAndDeductTokens(
      supabase, userId, tokenCost, "translate", `translate to ${targetLanguage}`,
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
    }

    const languageNames: Record<string, string> = {
      ur: "Urdu", ar: "Arabic", en: "English", fa: "Persian", pa: "Punjabi", ps: "Pashto",
    };
    const targetName = languageNames[targetLanguage] ?? targetLanguage;
    const sourceName = sourceLanguage ? (languageNames[sourceLanguage] ?? sourceLanguage) : null;

    const systemPrompt = `You are a professional translator. Translate the provided content into ${targetName}.${sourceName ? ` The source language is ${sourceName}.` : " Auto-detect the source language."}
Rules:
1. Produce ONLY the translated text — no explanations, notes, or metadata.
2. Preserve the original formatting, paragraph breaks, and structure.
3. Maintain proper text direction (RTL for Urdu/Arabic/Persian/Pashto, LTR for English).
4. If the source contains headings, bullet points, or numbered lists, preserve them.
5. Translate naturally and idiomatically — do not produce word-for-word literal translations.`;

    const userContent: Array<Record<string, unknown>> = [];

    if (imageBase64) {
      userContent.push({
        type: "text",
        text: `Translate all visible text in this image into ${targetName}. Preserve formatting.`,
      });
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` },
      });
    } else {
      userContent.push({
        type: "text",
        text: `Translate the following text into ${targetName}:\n\n${text}`,
      });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        stream: true,
        max_tokens: 8192,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!aiResponse.ok) {
      await refundTokens(supabase, userId, tokenCost, "translate", "AI gateway error");
      const errText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errText);

      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ error: "Translation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(aiResponse.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("translate-page error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
