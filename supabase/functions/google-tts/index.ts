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

// Map persona names to Google Cloud TTS voice names (Arabic, female/male)
function getCloudTtsVoice(personaId: string): { name: string; ssmlGender: string } {
  const voiceMap: Record<string, { name: string; ssmlGender: string }> = {
    zainab: { name: "ar-XA-Wavenet-A", ssmlGender: "FEMALE" },
    aisha: { name: "ar-XA-Wavenet-A", ssmlGender: "FEMALE" },
    fatima: { name: "ar-XA-Wavenet-D", ssmlGender: "FEMALE" },
    omar: { name: "ar-XA-Wavenet-B", ssmlGender: "MALE" },
    hamza: { name: "ar-XA-Wavenet-C", ssmlGender: "MALE" },
    yusuf: { name: "ar-XA-Wavenet-B", ssmlGender: "MALE" },
  };
  return voiceMap[personaId] || { name: "ar-XA-Wavenet-A", ssmlGender: "FEMALE" };
}

/** Create a 44-byte WAV header for 16-bit mono PCM */
function createWavHeader(pcmLength: number, sampleRate = 24000, channels = 1, bitsPerSample = 16): Uint8Array {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, pcmLength, true);

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Try Gemini TTS up to MAX_RETRIES times */
async function tryGeminiTts(
  text: string,
  voiceName: string,
  apiKey: string
): Promise<{ ok: true; pcmBytes: Uint8Array } | { ok: false; error: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text }] }],
    systemInstruction: {
      parts: [{ text: "Read aloud the following text exactly as given. Generate audio output only." }],
    },
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[TTS] Gemini attempt ${attempt}/${MAX_RETRIES}`);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(`[TTS] Gemini ${resp.status} (attempt ${attempt}):`, errText.slice(0, 300));
        if (resp.status < 500) {
          return { ok: false, error: `Gemini client error ${resp.status}: ${errText.slice(0, 200)}` };
        }
        if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue; }
        return { ok: false, error: `Gemini server error after ${MAX_RETRIES} retries` };
      }

      const data = await resp.json();
      const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inlineData?.data) {
        console.warn(`[TTS] Gemini OK but no audio (attempt ${attempt})`);
        if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue; }
        return { ok: false, error: "Gemini returned no audio data" };
      }

      const binaryString = atob(inlineData.data);
      const pcmBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) pcmBytes[i] = binaryString.charCodeAt(i);

      console.log(`[TTS] Gemini succeeded on attempt ${attempt}`);
      return { ok: true, pcmBytes };
    } catch (err) {
      console.error(`[TTS] Gemini network error (attempt ${attempt}):`, err);
      if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue; }
      return { ok: false, error: `Network error: ${String(err)}` };
    }
  }
  return { ok: false, error: "Exhausted retries" };
}

/** Fallback: Google Cloud Text-to-Speech REST API → returns LINEAR16 WAV bytes */
async function tryGoogleCloudTts(
  text: string,
  personaId: string,
  apiKey: string
): Promise<{ ok: true; wavBytes: Uint8Array } | { ok: false; error: string }> {
  const voice = getCloudTtsVoice(personaId);
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
  const body = {
    input: { text },
    voice: { languageCode: "ar-XA", name: voice.name, ssmlGender: voice.ssmlGender },
    audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 },
  };

  console.log(`[TTS] Falling back to Google Cloud TTS (voice: ${voice.name})`);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[TTS] Cloud TTS error ${resp.status}:`, errText.slice(0, 300));
      return { ok: false, error: `Cloud TTS error ${resp.status}: ${errText.slice(0, 200)}` };
    }

    const data = await resp.json();
    if (!data.audioContent) {
      return { ok: false, error: "Cloud TTS returned no audioContent" };
    }

    // Cloud TTS with LINEAR16 returns a full WAV file as base64
    const binaryString = atob(data.audioContent);
    const wavBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) wavBytes[i] = binaryString.charCodeAt(i);

    console.log("[TTS] Google Cloud TTS succeeded");
    return { ok: true, wavBytes };
  } catch (err) {
    console.error("[TTS] Cloud TTS network error:", err);
    return { ok: false, error: `Cloud TTS network error: ${String(err)}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_TTS_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API key not configured. Set GEMINI_API_KEY or GOOGLE_TTS_API_KEY." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isRateLimited(user.id, 20, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    const { text, personaId } = await req.json();
    if (!text) {
      return new Response(JSON.stringify({ error: "Missing text" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Subscription check
    const { data: sub, error: subError } = await supabase
      .from("subscriptions")
      .select("tier, tts_characters_used, tts_character_limit")
      .eq("user_id", user.id)
      .single();

    if (subError || !sub) {
      return new Response(JSON.stringify({ error: "Subscription not found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const charCount = text.length;
    const limit = sub.tier === "pro" ? 999999 : sub.tts_character_limit;
    if (sub.tts_characters_used + charCount > limit && sub.tier === "free") {
      return new Response(JSON.stringify({ error: "TTS character limit reached" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pid = personaId || "fatima";
    const voiceName = getGeminiVoice(pid);

    // ── Step 1: Try Gemini TTS (3 retries) ──
    const geminiResult = await tryGeminiTts(text, voiceName, apiKey);

    let wavFile: Uint8Array;

    if (geminiResult.ok) {
      // Wrap raw PCM in WAV header
      const wavHeader = createWavHeader(geminiResult.pcmBytes.length, 24000, 1, 16);
      wavFile = new Uint8Array(wavHeader.length + geminiResult.pcmBytes.length);
      wavFile.set(wavHeader, 0);
      wavFile.set(geminiResult.pcmBytes, wavHeader.length);
    } else {
      // ── Step 2: Fallback to Google Cloud TTS ──
      console.warn(`[TTS] Gemini failed: ${geminiResult.error}. Trying Cloud TTS...`);
      const cloudResult = await tryGoogleCloudTts(text, pid, apiKey);

      if (!cloudResult.ok) {
        console.error(`[TTS] All engines failed. Gemini: ${geminiResult.error}. Cloud: ${cloudResult.error}`);
        return new Response(
          JSON.stringify({
            error: "TTS generation failed — all engines exhausted",
            details: { gemini: geminiResult.error, cloudTts: cloudResult.error },
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Cloud TTS LINEAR16 already returns a full WAV
      wavFile = cloudResult.wavBytes;
    }

    // Update usage
    await supabase
      .from("subscriptions")
      .update({ tts_characters_used: sub.tts_characters_used + charCount })
      .eq("user_id", user.id);

    return new Response(wavFile as Uint8Array, {
      headers: { ...corsHeaders, "Content-Type": "audio/wav", "Content-Disposition": "inline" },
    });
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
