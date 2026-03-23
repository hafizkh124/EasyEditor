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
    zainab: "Aoede",
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

    // ── Model definitions with retry & fallback ──
    // Primary: gemini-2.5-flash-preview-tts (supports systemInstruction)
    // Fallback: gemini-2.0-flash (no systemInstruction for audio mode)
    const MODELS = [
      {
        id: "gemini-2.5-flash-preview-tts",
        label: "Gemini 2.5 Flash TTS",
        body: {
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
        },
      },
      {
        id: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash (fallback)",
        body: {
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName }
              }
            }
          }
        },
      },
    ];

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 500;
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /** Try a single model up to MAX_RETRIES times (only retries on 500+ errors) */
    async function tryModelWithRetries(
      model: typeof MODELS[number],
      apiKey: string
    ): Promise<{ ok: true; inlineData: { data: string; mimeType: string } } | { ok: false; lastStatus: number; lastError: unknown }> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${apiKey}`;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[TTS] ${model.label} — attempt ${attempt}/${MAX_RETRIES}`);

        let resp: Response;
        try {
          resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(model.body),
          });
        } catch (networkErr) {
          console.error(`[TTS] ${model.label} network error (attempt ${attempt}):`, networkErr);
          if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue; }
          return { ok: false, lastStatus: 502, lastError: String(networkErr) };
        }

        // Non-retryable client errors (400, 401, 403, 404, 429)
        if (!resp.ok && resp.status < 500) {
          const errBody = await resp.text();
          let parsed: unknown = errBody;
          try { parsed = JSON.parse(errBody); } catch { /* keep raw */ }
          console.error(`[TTS] ${model.label} client error ${resp.status}:`, JSON.stringify(parsed, null, 2));
          return { ok: false, lastStatus: resp.status, lastError: parsed };
        }

        // Retryable server errors (500+)
        if (!resp.ok) {
          const errBody = await resp.text();
          let parsed: unknown = errBody;
          try { parsed = JSON.parse(errBody); } catch { /* keep raw */ }
          console.warn(`[TTS] ${model.label} server error ${resp.status} (attempt ${attempt}):`, JSON.stringify(parsed, null, 2));
          if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue; }
          return { ok: false, lastStatus: resp.status, lastError: parsed };
        }

        // Success — extract audio
        const data = await resp.json();
        const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!inlineData?.data) {
          console.warn(`[TTS] ${model.label} returned OK but no audio data (attempt ${attempt}):`, JSON.stringify(data).slice(0, 500));
          if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue; }
          return { ok: false, lastStatus: 200, lastError: "No audio data in successful response" };
        }

        console.log(`[TTS] ${model.label} succeeded on attempt ${attempt}`);
        return { ok: true, inlineData };
      }

      return { ok: false, lastStatus: 500, lastError: "Exhausted retries" };
    }

    // ── Execute: try each model in order ──
    let audioResult: { data: string; mimeType: string } | null = null;
    let usedModel = "";
    const allErrors: Array<{ model: string; status: number; error: unknown }> = [];

    for (const model of MODELS) {
      const result = await tryModelWithRetries(model, GEMINI_API_KEY);
      if (result.ok) {
        audioResult = result.inlineData;
        usedModel = model.label;
        break;
      }
      allErrors.push({ model: model.label, status: result.lastStatus, error: result.lastError });
      console.warn(`[TTS] ${model.label} failed after ${MAX_RETRIES} retries, trying next model...`);
    }

    if (!audioResult) {
      console.error("[TTS] All models failed:", JSON.stringify(allErrors, null, 2));
      return new Response(
        JSON.stringify({
          error: "TTS generation failed — all models exhausted",
          failedModels: allErrors,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[TTS] Audio generated via ${usedModel}`);
    const inlineData = audioResult;

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
