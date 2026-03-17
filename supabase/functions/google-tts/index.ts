import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Urdu (Nastaliq/Arabic script) to Hindi (Devanagari) transliteration map
// This allows hi-IN voices to correctly pronounce Urdu text
function transliterateUrduToDevanagari(text: string): string {
  const map: Record<string, string> = {
    // Urdu letters → Devanagari equivalents
    'ا': 'अ', 'آ': 'आ', 'ب': 'ब', 'پ': 'प', 'ت': 'त', 'ٹ': 'ट',
    'ث': 'स', 'ج': 'ज', 'چ': 'च', 'ح': 'ह', 'خ': 'ख़',
    'د': 'द', 'ڈ': 'ड', 'ذ': 'ज़', 'ر': 'र', 'ڑ': 'ड़',
    'ز': 'ज़', 'ژ': 'झ', 'س': 'स', 'ش': 'श', 'ص': 'स',
    'ض': 'ज़', 'ط': 'त', 'ظ': 'ज़', 'ع': 'अ', 'غ': 'ग़',
    'ف': 'फ़', 'ق': 'क़', 'ک': 'क', 'گ': 'ग', 'ل': 'ल',
    'م': 'म', 'ن': 'न', 'ں': 'ं', 'و': 'व', 'ہ': 'ह', 'ھ': 'ह',
    'ء': '', 'ی': 'य', 'ے': 'ए', 'ئ': 'ई',
    // Diacritics (Harakat)
    'َ': 'ा', 'ِ': 'ि', 'ُ': 'ु', 'ّ': '्', 'ً': 'न',
    'ٰ': 'ा', 'ٖ': 'ि',
    // Common conjuncts
    'ك': 'क', 'ي': 'ी', 'ة': 'ह',
    // Punctuation
    '،': ',', '؟': '?', '۔': '।',
    // Numbers
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  };

  let result = '';
  for (const char of text) {
    result += map[char] !== undefined ? map[char] : char;
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GOOGLE_TTS_API_KEY = Deno.env.get("GOOGLE_TTS_API_KEY");
    if (!GOOGLE_TTS_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Google TTS API key not configured" }),
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

    const { text, languageCode, voiceName, speed } = await req.json();

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

    // Determine voice config — Google TTS has no ur-PK voices, use hi-IN as fallback
    const resolvedLang = languageCode || "hi-IN";
    const resolvedVoice = voiceName || "hi-IN-Wavenet-A";

    // Transliterate Urdu/Arabic script to Devanagari for hi-IN voices
    // hi-IN voices can only read Devanagari/Latin, not Nastaliq/Arabic script
    let processedText = text;
    if (resolvedLang === "hi-IN") {
      processedText = transliterateUrduToDevanagari(text);
    }

    // Use SSML to explicitly set xml:lang for correct pronunciation
    const ssmlText = `<speak xml:lang="${resolvedLang}">${processedText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</speak>`;

    // Call Google Cloud Text-to-Speech API
    const googleResponse = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          input: { ssml: ssmlText },
          voice: {
            languageCode: resolvedLang,
            name: resolvedVoice,
          },
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate: speed || 1.0,
            pitch: 0,
          },
        }),
      }
    );

    if (!googleResponse.ok) {
      const errBody = await googleResponse.text();
      console.error("Google TTS API error:", googleResponse.status, errBody);
      return new Response(
        JSON.stringify({ error: "TTS generation failed", details: errBody }),
        { status: googleResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await googleResponse.json();
    const audioContent = data.audioContent; // base64-encoded MP3

    if (!audioContent) {
      return new Response(
        JSON.stringify({ error: "No audio content returned" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update usage
    await supabase
      .from("subscriptions")
      .update({ tts_characters_used: sub.tts_characters_used + charCount })
      .eq("user_id", userId);

    // Decode base64 to binary and return as audio
    const binaryString = atob(audioContent);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Response(bytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
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
