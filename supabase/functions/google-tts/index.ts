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
    zainab: "Kore",
    omar: "Puck",
    fatima: "Zephyr",
    hamza: "Charon",
    aisha: "Aoede",
    yusuf: "Orus",
  };
  return voiceMap[personaId] || "Zephyr";
}

/** Create a 44-byte WAV header for 16-bit mono PCM at the given sample rate */
function createWavHeader(pcmLength: number, sampleRate = 24000, channels = 1, bitsPerSample = 16): Uint8Array {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmLength;
  const fileSize = 36 + dataSize; // 44 - 8 header bytes

  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, fileSize, true);
  writeString(view, 8, "WAVE");

  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // sub-chunk size (PCM = 16)
  view.setUint16(20, 1, true);  // audio format (1 = PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_TTS_API_KEY");
    if (!GEMINI_API_KEY) {
      console.error("No API key found. Checked GEMINI_API_KEY and GOOGLE_TTS_API_KEY.");
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured. Set GEMINI_API_KEY or GOOGLE_TTS_API_KEY." }),
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

    // Call Gemini API with audio modality using stable model
    let geminiResponse: Response;
    try {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
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
    } catch (fetchErr) {
      console.error("Gemini fetch network error:", fetchErr);
      return new Response(
        JSON.stringify({ error: "Failed to reach Gemini API", details: String(fetchErr) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!geminiResponse.ok) {
      const errBody = await geminiResponse.text();
      let parsedError: unknown = errBody;
      try { parsedError = JSON.parse(errBody); } catch { /* keep raw */ }
      console.error("Gemini TTS API error:", geminiResponse.status, JSON.stringify(parsedError, null, 2));
      return new Response(
        JSON.stringify({ error: "TTS generation failed", status: geminiResponse.status, details: parsedError }),
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

    // Decode the base64 PCM data from Gemini
    const rawBase64 = inlineData.data;
    const binaryString = atob(rawBase64);
    const pcmBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      pcmBytes[i] = binaryString.charCodeAt(i);
    }

    // Create WAV file: 44-byte header + raw PCM
    const wavHeader = createWavHeader(pcmBytes.length, 24000, 1, 16);
    const wavFile = new Uint8Array(wavHeader.length + pcmBytes.length);
    wavFile.set(wavHeader, 0);
    wavFile.set(pcmBytes, wavHeader.length);

    // Update usage
    await supabase
      .from("subscriptions")
      .update({ tts_characters_used: sub.tts_characters_used + charCount })
      .eq("user_id", userId);

    // Return binary WAV directly
    return new Response(wavFile.buffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/wav",
        "Content-Disposition": "inline",
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
