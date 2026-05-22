import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";

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
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured" }),
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

    const { text, voiceId, speed } = await req.json();

    if (!text || !voiceId) {
      return new Response(
        JSON.stringify({ error: "Missing text or voiceId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const charCount = text.length;

    // Token-based quota check: 500 tokens per 1K characters (ElevenLabs premium)
    const tokenCost = calculateCost("tts_elevenlabs", Math.ceil(charCount / 1000));
    const tokenResult = await checkAndDeductTokens(
      supabase, userId, tokenCost, "tts_elevenlabs",
      `${charCount} chars ElevenLabs TTS`,
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
    }

    // Call ElevenLabs TTS API
    const elevenLabsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
            speed: speed || 1.0,
          },
        }),
      }
    );

    if (!elevenLabsResponse.ok) {
      // Refund tokens on ElevenLabs failure
      await refundTokens(supabase, userId, tokenCost, "tts_elevenlabs", "ElevenLabs API error");

      const errBody = await elevenLabsResponse.text();
      console.error("ElevenLabs API error:", elevenLabsResponse.status, errBody);
      return new Response(
        JSON.stringify({ error: "TTS generation failed", details: errBody }),
        { status: elevenLabsResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update legacy usage counter (backward compat analytics)
    supabase
      .from("subscriptions")
      .select("tts_characters_used")
      .eq("user_id", userId)
      .single()
      .then(({ data: sub }) => {
        if (sub) {
          supabase
            .from("subscriptions")
            .update({ tts_characters_used: (sub.tts_characters_used ?? 0) + charCount })
            .eq("user_id", userId)
            .then(() => {});
        }
      });

    const audioBuffer = await elevenLabsResponse.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Content-Disposition": "inline",
        "X-Tokens-Used": String(tokenCost),
      },
    });
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
