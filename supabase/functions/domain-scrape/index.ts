/**
 * domain-scrape — Tier C: live scraping of Islamic fatwa/Q&A / classical sites
 * via Firecrawl (direct API, `fc-` key).
 *
 * Strategy:
 *   1. For each requested domain, call Firecrawl `/v2/search` with a
 *      `site:<host> <query>` query and `formats:['markdown']` to get 1-2 top
 *      results *with content* in a single round-trip (no separate scrape).
 *   2. Extract lightweight citation metadata (fatwa number / hadith slug)
 *      from the returned URL when the pattern is known; otherwise fall back
 *      to url + title only.
 *
 * Response shape (unchanged): `{ results: IslamicResult[] }` — safe drop-in
 * for the previous bespoke-regex scrapers.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import type { IslamicResult } from "../islamic-api-fetch/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

// ── Domain registry ─────────────────────────────────────────────────────────
// Every host here MUST also appear in `src/lib/research/scrapingWhitelist.ts`
// (mirrored in `supabase/functions/research-query/index.ts`) so upstream
// citation rules stay in sync.
interface DomainConfig {
  host: string;
  lang: "en" | "ur" | "ar";
  type: "fatwa" | "hadith" | "classical" | "article";
  /** Optional URL → citation fields extractor. */
  citation?: (url: string) => Record<string, string | number>;
}

const DOMAINS: Record<string, DomainConfig> = {
  islamqa: {
    host: "islamqa.info",
    lang: "en",
    type: "fatwa",
    citation: (u) => {
      // Matches /en/answers/173637, /ur/answers/145725/, etc.
      const m = u.match(/\/answers\/(\d+)(?:\/|$|\?|#)/i);
      return m ? { fatwa_number: m[1] } : {};
    },
  },
  islamweb: {
    host: "www.islamweb.net",
    lang: "en",
    type: "fatwa",
    citation: (u) => {
      // Legacy: ?FatwaId=12345 | Modern: /en/fatwa/449197/slug
      const m =
        u.match(/FatwaId=(\d+)/i) ??
        u.match(/\/fatwa\/(\d+)(?:\/|$|\?|#)/i);
      return m ? { fatwa_number: m[1] } : {};
    },
  },
  islamicurdubooks: {
    host: "www.islamicurdubooks.com",
    lang: "ur",
    type: "hadith",
    citation: (u) => {
      const bookId = u.match(/bookid=(\d+)/i)?.[1];
      const hn = u.match(/(?:hadith_number|hadithno)=(\d+)/i)?.[1];
      const out: Record<string, string> = {};
      if (bookId) out.book = `Book ${bookId}`;
      if (hn) out.hadith_number = hn;
      return out;
    },
  },
  shamilaurdu: {
    host: "shamilaurdu.com",
    lang: "ur",
    type: "hadith",
    citation: (u) => {
      const m = u.match(/shamilaurdu\.com\/(hadith|book|quran)\/([^/]+)\/(\d+)/i);
      if (!m) return {};
      const [, section, slug, num] = m;
      const out: Record<string, string | number> = { book: slug };
      if (section === "hadith") out.hadith_number = num;
      else if (section === "book") out.page = Number(num);
      else if (section === "quran") out.surah_number = Number(num);
      return out;
    },
  },
  alulama:            { host: "alulama.org",             lang: "ur", type: "fatwa" },
  "darulifta-deoband":{
    host: "darulifta-deoband.com",
    lang: "ur",
    type: "fatwa",
    citation: (u) => {
      const m = u.match(/\/(?:fatwa|home)\/(\d+)/i) || u.match(/question\.php\?id=(\d+)/i);
      return m ? { fatwa_number: m[1] } : {};
    },
  },
  "magazine-mohaddis":{ host: "magazine.mohaddis.com",   lang: "ur", type: "article" },
  mohaddis:           { host: "mohaddis.org",            lang: "ur", type: "article" },
  urdufatwa:          {
    host: "urdufatwa.com",
    lang: "ur",
    type: "fatwa",
    citation: (u) => {
      const m = u.match(/\/fatwa\/(\d+)/i) || u.match(/id=(\d+)/i);
      return m ? { fatwa_number: m[1] } : {};
    },
  },
  islamfort:          { host: "islamfort.com",           lang: "ur", type: "article" },
  alminasa:           { host: "alminasa.ai",             lang: "ar", type: "article" },
  shamela:            { host: "shamela.ws",              lang: "ar", type: "classical" },
};

export const SUPPORTED_DOMAINS = Object.keys(DOMAINS);

// ── Firecrawl search+scrape for a single domain ─────────────────────────────
async function scrapeDomain(
  key: string,
  cfg: DomainConfig,
  query: string,
  apiKey: string,
): Promise<IslamicResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(`${FIRECRAWL_V2}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        query: `site:${cfg.host} ${query}`,
        limit: 2,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[domain-scrape] Firecrawl ${res.status} for ${key}: ${errBody.slice(0, 300)}`);
      return [];
    }
    const json = await res.json();
    // v2 responses may put items under `data` or `data.web`; normalize.
    const raw = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.data?.web)
      ? json.data.web
      : [];

    const out: IslamicResult[] = [];
    for (const item of raw) {
      const url: string | undefined = item?.url;
      const title: string = (item?.title ?? "").toString().slice(0, 200);
      const markdown: string = (item?.markdown ?? item?.description ?? "").toString().trim();
      if (!url || !markdown || markdown.length < 60) continue;

      const content = title
        ? `**${title}**\n\n${markdown.slice(0, 3_500)}`
        : markdown.slice(0, 3_500);

      const citationExtras = cfg.citation?.(url) ?? {};

      out.push({
        domain: key,
        content,
        citation_ref: { ...citationExtras, url } as any,
        language: cfg.lang,
      });
    }
    return out;
  } catch (e) {
    clearTimeout(timeout);
    console.error(`[domain-scrape] ${key} failed:`, (e as Error).message);
    return [];
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
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Firecrawl not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { query, selectedDomains } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Choose which domains to hit. `selectedDomains` filters to the intersection
    // with SUPPORTED_DOMAINS; when omitted, we fan out to every registered host.
    const targets: string[] = Array.isArray(selectedDomains) && selectedDomains.length > 0
      ? selectedDomains.filter((d: string) => d in DOMAINS)
      : SUPPORTED_DOMAINS;

    const settled = await Promise.allSettled(
      targets.map((key) => scrapeDomain(key, DOMAINS[key], query, apiKey)),
    );

    const results: IslamicResult[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(...r.value);
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("domain-scrape error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}

serve(handle);
