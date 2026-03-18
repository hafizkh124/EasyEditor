import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Map persona names to Gemini prebuilt voice IDs
function getGeminiVoice(personaId: string): string {
  const voiceMap: Record<string, string> = {
    zainab: "Kore",      // female
    omar: "Puck",        // male
    fatima: "Zephyr",    // female
    hamza: "Charon",     // male
    aisha: "Aoede",      // female
    yusuf: "Orus",       // male
  };
  return voiceMap[personaId] || "Zephyr";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
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

    // Rate limit: 20 TTS requests per user per minute
    if (isRateLimited(userId, 20, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    const { text, personaId } = await req.json();

    if (!text) {
      return new Response(
        JSON.stringify({ error: "Missing text" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check subscription limits
    const { data: sub, error: subError } = await supabase
      .from("subscriptions")
      .select("tier, tts_characters_used, tts_character_limit")
      .eq("user_id", userId)
      .single();

    if (subError || !sub) {
      return new Response(
        JSON.stringify({ error: "Subscription not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const charCount = text.length;
    const limit = sub.tier === "pro" ? 999999 : sub.tts_character_limit;
    if (sub.tts_characters_used + charCount > limit && sub.tier === "free") {
      return new Response(
        JSON.stringify({ error: "TTS character limit reached" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const voiceName = getGeminiVoice(personaId || "fatima");

    // Call Gemini API with audio modality
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          systemInstruction: {
            parts: [{ text: "Read aloud the following text exactly as given. Generate audio output only." }]
          },
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName }
              }
            }
          }
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errBody = await geminiResponse.text();
      console.error("Gemini TTS API error:", geminiResponse.status, errBody);
      return new Response(
        JSON.stringify({ error: "TTS generation failed", details: errBody }),
        { status: geminiResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await geminiResponse.json();
    const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;

    if (!inlineData?.data) {
      console.error("No audio data in Gemini response:", JSON.stringify(data).slice(0, 500));
      return new Response(
        JSON.stringify({ error: "No audio content returned from Gemini" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update usage
    await supabase
      .from("subscriptions")
      .update({ tts_characters_used: sub.tts_characters_used + charCount })
      .eq("user_id", userId);

    // Return base64 audio data as JSON
    return new Response(
      JSON.stringify({
        audioBase64: inlineData.data,
        mimeType: inlineData.mimeType || "audio/wav",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
