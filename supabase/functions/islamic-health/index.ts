// Islamic research upstream health check. Admin-only.
// Fires one canned probe at each upstream and returns latency + ok flag.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface HealthResult {
  name: string;
  ok: boolean;
  latency_ms: number;
  sample_hits: number;
  note?: string;
}

const PROBE_QUERY_AR = "الصدقة";
const PROBE_QUERY_EN = "charity";

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - t0)];
}

async function probeDorar(): Promise<HealthResult> {
  // Uses the current Dorar endpoint (https://dorar.net/dorar_api.json?skey=…).
  // The old /v1/api/hadith/search path returns 404 as of 2026-05.
  try {
    const [res, ms] = await timed(() =>
      fetch(`https://dorar.net/dorar_api.json?skey=${encodeURIComponent(PROBE_QUERY_AR)}`, {
        signal: AbortSignal.timeout(8_000),
      }),
    );
    if (!res.ok) return { name: "dorar", ok: false, latency_ms: ms, sample_hits: 0, note: `HTTP ${res.status}` };
    const data = await res.json();
    const html: string = data?.ahadith?.result ?? "";
    // Count how many hadith blocks the result HTML contains as a proxy for hit count.
    const matches = html.match(/الراوي/g)?.length ?? 0;
    return { name: "dorar", ok: matches > 0, latency_ms: ms, sample_hits: matches, note: matches === 0 ? "empty result html" : undefined };
  } catch (e) {
    return { name: "dorar", ok: false, latency_ms: 0, sample_hits: 0, note: String(e) };
  }
}

async function probeAlQuran(): Promise<HealthResult> {
  try {
    const [res, ms] = await timed(() =>
      fetch(`https://api.alquran.cloud/v1/search/${encodeURIComponent(PROBE_QUERY_EN)}/all/en.sahih`, {
        signal: AbortSignal.timeout(8_000),
      }),
    );
    if (!res.ok) return { name: "alquran", ok: false, latency_ms: ms, sample_hits: 0, note: `HTTP ${res.status}` };
    const data = await res.json();
    return { name: "alquran", ok: true, latency_ms: ms, sample_hits: (data?.data?.matches ?? []).length };
  } catch (e) {
    return { name: "alquran", ok: false, latency_ms: 0, sample_hits: 0, note: String(e) };
  }
}

async function probeQuranCom(): Promise<HealthResult> {
  try {
    const [res, ms] = await timed(() =>
      fetch(`https://api.quran.com/api/v4/search?q=${encodeURIComponent(PROBE_QUERY_EN)}&size=3`, {
        signal: AbortSignal.timeout(8_000),
      }),
    );
    if (!res.ok) return { name: "quran-com", ok: false, latency_ms: ms, sample_hits: 0, note: `HTTP ${res.status}` };
    const data = await res.json();
    return { name: "quran-com", ok: true, latency_ms: ms, sample_hits: (data?.search?.results ?? []).length };
  } catch (e) {
    return { name: "quran-com", ok: false, latency_ms: 0, sample_hits: 0, note: String(e) };
  }
}

async function probeHadithApi(): Promise<HealthResult> {
  const key = Deno.env.get("HADITH_API_KEY") ?? "";
  if (!key) {
    return { name: "hadith-api", ok: false, latency_ms: 0, sample_hits: 0, note: "HADITH_API_KEY not set" };
  }
  try {
    const [res, ms] = await timed(() =>
      fetch(`https://hadithapi.com/api/hadiths/?apiKey=${encodeURIComponent(key)}&hadithEnglish=${encodeURIComponent(PROBE_QUERY_EN)}&paginate=3`, {
        signal: AbortSignal.timeout(10_000),
      }),
    );
    if (!res.ok) return { name: "hadith-api", ok: false, latency_ms: ms, sample_hits: 0, note: `HTTP ${res.status}` };
    const data = await res.json();
    const hits = (data?.hadiths?.data ?? data?.hadiths ?? []).length;
    return { name: "hadith-api", ok: hits > 0, latency_ms: ms, sample_hits: hits };
  } catch (e) {
    return { name: "hadith-api", ok: false, latency_ms: 0, sample_hits: 0, note: String(e) };
  }
}

// probeSunnah removed per Phase 7.5 doctrine (no API key).
// probeScraper("dar-alifta", ...) likewise dropped from the probe list below.

async function probeEmbedding(): Promise<HealthResult> {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!key) return { name: "embeddings", ok: false, latency_ms: 0, sample_hits: 0, note: "GEMINI_API_KEY not set" };
  try {
    const [res, ms] = await timed(() =>
      fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
        {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            model:                "models/gemini-embedding-001",
            content:              { parts: [{ text: PROBE_QUERY_EN }] },
            outputDimensionality: 768,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      ),
    );
    if (!res.ok) return { name: "embeddings", ok: false, latency_ms: ms, sample_hits: 0, note: `HTTP ${res.status}` };
    const data = await res.json();
    const dims = data?.embedding?.values?.length ?? 0;
    return { name: "embeddings", ok: dims === 768, latency_ms: ms, sample_hits: dims, note: dims === 768 ? undefined : `unexpected dim ${dims}` };
  } catch (e) {
    return { name: "embeddings", ok: false, latency_ms: 0, sample_hits: 0, note: String(e) };
  }
}

async function probeGemini(): Promise<HealthResult> {
  const key = Deno.env.get("LOVABLE_API_KEY") ?? "";
  if (!key) return { name: "gemini", ok: false, latency_ms: 0, sample_hits: 0, note: "LOVABLE_API_KEY not set" };
  try {
    const [res, ms] = await timed(() =>
      fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: "Say OK." }],
          max_tokens: 4,
        }),
        signal: AbortSignal.timeout(10_000),
      }),
    );
    if (!res.ok) return { name: "gemini", ok: false, latency_ms: ms, sample_hits: 0, note: `HTTP ${res.status}` };
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return { name: "gemini", ok: text.length > 0, latency_ms: ms, sample_hits: text.length };
  } catch (e) {
    return { name: "gemini", ok: false, latency_ms: 0, sample_hits: 0, note: String(e) };
  }
}

async function probeVectorRpc(supabase: ReturnType<typeof createClient>): Promise<HealthResult> {
  try {
    // Use a zero vector — the RPC should still execute and return rows (or empty), not error.
    const zero = new Array(768).fill(0);
    const [{ data, error }, ms] = await timed(() =>
      supabase.rpc("match_scholarly_documents", {
        query_embedding: zero,
        match_threshold: 0.0,
        match_count: 1,
        filter_domains: null,
        filter_language: null,
      }),
    );
    if (error) return { name: "pgvector-rpc", ok: false, latency_ms: ms, sample_hits: 0, note: error.message };
    return { name: "pgvector-rpc", ok: true, latency_ms: ms, sample_hits: (data ?? []).length };
  } catch (e) {
    return { name: "pgvector-rpc", ok: false, latency_ms: 0, sample_hits: 0, note: String(e) };
  }
}

async function probeScraper(name: string, url: string): Promise<HealthResult> {
  try {
    const [res, ms] = await timed(() =>
      fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ScribeStudioHealthBot/1.0)" },
        signal: AbortSignal.timeout(10_000),
      }),
    );
    if (!res.ok) return { name, ok: false, latency_ms: ms, sample_hits: 0, note: `HTTP ${res.status}` };
    const html = await res.text();
    return { name, ok: html.length > 500, latency_ms: ms, sample_hits: html.length };
  } catch (e) {
    return { name, ok: false, latency_ms: 0, sample_hits: 0, note: String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = await Promise.all([
      probeDorar(),
      probeAlQuran(),
      probeQuranCom(),
      probeHadithApi(),
      probeEmbedding(),
      probeGemini(),
      probeVectorRpc(supabase),
      probeScraper("islamqa", `https://islamqa.info/en/search?q=${encodeURIComponent(PROBE_QUERY_EN)}`),
      probeScraper("islamweb", `https://www.islamweb.net/en/fatwa/search/?q=${encodeURIComponent(PROBE_QUERY_EN)}`),
      probeScraper("islamicurdubooks", `https://www.islamicurdubooks.com/hadith/search_urdu.php?q=${encodeURIComponent(PROBE_QUERY_AR)}`),
      // ShamilaUrdu uses DuckDuckGo for URL discovery — probe DDG with a site: query.
      probeScraper("shamilaurdu", `https://html.duckduckgo.com/html?q=${encodeURIComponent("site:shamilaurdu.com " + PROBE_QUERY_AR)}`),
    ]);

    return new Response(JSON.stringify({ results, generated_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("islamic-health error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
