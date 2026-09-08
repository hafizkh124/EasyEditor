/**
 * domain-scrape — Tier C: live scraping of Islamic fatwa/Q&A / classical sites.
 *
 * Reimplemented free (no Firecrawl, no API key) after the paid Firecrawl
 * version was retired 2026-09-08. Two-step pipeline per domain:
 *   1. Site-scoped search via DuckDuckGo's keyless HTML endpoint
 *      (`site:<host> <query>`) to find 1-2 candidate pages — this replaces
 *      Firecrawl's `/v2/search`.
 *   2. A plain `fetch` of each candidate with a browser-like User-Agent,
 *      parsed with linkedom and reduced to its main article text with a
 *      lightweight readability heuristic — this replaces Firecrawl's
 *      `scrapeOptions: { formats: ['markdown'], onlyMainContent: true }`.
 *
 * Response shape (unchanged): `{ results: IslamicResult[] }`.
 *
 * Trade-off vs. Firecrawl: no JS rendering and no anti-bot handling. Every
 * host below was chosen because it already returns readable server-rendered
 * HTML to a plain fetch (verified during the M9 ADR-0022 whitelist pass with
 * this same User-Agent) — this reimplementation leans on that, not on
 * Firecrawl's headless-browser fallback. If a host starts requiring JS or
 * blocking non-browser UAs, it will silently return zero results here (the
 * per-domain try/catch degrades to `[]`, same as before) rather than error.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// `/worker` export: same parseHTML, but without the optional `canvas` native
// dependency that the default entry pulls in (it fails to bundle on Deno Deploy).
import { parseHTML } from "https://esm.sh/linkedom@0.18.13/worker";
import type { IslamicResult } from "../islamic-api-fetch/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// A real browser UA, not a bot string — DuckDuckGo's HTML endpoint and some
// of the target sites are more likely to serve full content to this than to
// an obvious bot UA (unlike the *whitelist-validation* fetch, which used a
// declared `ResearchBot/1.0` UA specifically so a site owner could see who
// was hitting them — this function makes many more requests per query, so it
// intentionally does not repeat that identification).
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// ── Domain registry ─────────────────────────────────────────────────────────
// Every host here MUST also appear in `src/lib/research/scrapingWhitelist.ts`
// (mirrored in `supabase/functions/research-query/index.ts`) so upstream
// citation rules stay in sync. The relationship is one-way — DOMAINS ⊆
// whitelist — and `researchSources.test.ts` enforces it.
//
// M9 ADR-0022 (2026-09-04): the whitelist was widened with five fiqh-academy /
// dar al-ifta hosts (iifa-aifi.org, dar-alifta.org, aliftaa.jo, binbaz.org.sa,
// banuri.edu.pk). They are deliberately NOT registered here, because:
//   1. The two paths are independent. `isWhitelistedUrl` gates research-query's
//      DIRECT fetch of user-supplied source URLs; results from this function
//      bypass that check entirely and are injected as context. Widening the
//      whitelist is therefore sufficient for the goal — letting the research
//      channel read and cite these bodies.
//   2. Registering a host here makes this function fan out to it on EVERY
//      Islamic-flavoured General query (research-query omits `selectedDomains`).
//      Five more hosts is five more search+fetch round trips per query.
// Add a host here only when its search results are actually wanted in the
// Tier-C fan-out, and give it a real `citation` extractor when you do.
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

// ── Step 1: DuckDuckGo HTML search, scoped to one site ──────────────────────
// DDG wraps every result href through its own redirector
// (`//duckduckgo.com/l/?uddg=<url-encoded-target>&rut=...`) instead of
// linking straight to the target — this unwraps that. A direct `https://`
// href (no wrapper) is passed through unchanged, in case DDG's markup drops
// the redirector for some result types.
function unwrapDuckDuckGoLink(href: string): string | null {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    if (u.hostname.endsWith("duckduckgo.com") && u.pathname === "/l/") {
      const target = u.searchParams.get("uddg");
      return target ? decodeURIComponent(target) : null;
    }
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

async function searchSite(host: string, query: string, limit: number): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": BROWSER_UA,
      },
      body: new URLSearchParams({ q: `site:${host} ${query}` }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];

    const html = await res.text();
    const { document: doc } = parseHTML(html);

    const urls: string[] = [];
    const seen = new Set<string>();
    for (const a of Array.from(doc.querySelectorAll("a.result__a"))) {
      const href = a.getAttribute("href");
      if (!href) continue;
      const real = unwrapDuckDuckGoLink(href);
      if (!real || seen.has(real)) continue;
      seen.add(real);
      urls.push(real);
      if (urls.length >= limit) break;
    }
    return urls;
  } catch (e) {
    clearTimeout(timeout);
    console.error(`[domain-scrape] search failed for ${host}:`, (e as Error).message);
    return [];
  }
}

// ── Step 2: fetch + readability-style extraction ────────────────────────────
const NOISE_SELECTORS = "script, style, nav, header, footer, aside, form, button, svg, noscript, iframe";
const CONTENT_SELECTORS = [
  "article",
  "main",
  ".entry-content",
  ".post-content",
  ".fatwa-content",
  ".content-area",
  "#content",
  ".content",
];

function collapseWhitespace(s: string): string {
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function extractArticle(html: string): { title: string; text: string } | null {
  const { document: doc } = parseHTML(html);

  for (const noisy of Array.from(doc.querySelectorAll(NOISE_SELECTORS))) {
    noisy.remove();
  }

  let container: ReturnType<typeof doc.querySelector> = null;
  for (const sel of CONTENT_SELECTORS) {
    const found = doc.querySelector(sel);
    if (found && (found.textContent?.trim().length ?? 0) > 200) {
      container = found;
      break;
    }
  }
  const text = collapseWhitespace((container ?? doc.body)?.textContent ?? "");
  if (text.length < 200) return null;

  const title = doc.querySelector("h1")?.textContent?.trim()
    || doc.querySelector("title")?.textContent?.trim()
    || "";
  return { title: title.slice(0, 200), text };
}

async function fetchAndExtract(url: string): Promise<{ title: string; text: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    return extractArticle(html);
  } catch (e) {
    clearTimeout(timeout);
    console.error(`[domain-scrape] fetch failed for ${url}:`, (e as Error).message);
    return null;
  }
}

// ── Per-domain pipeline ──────────────────────────────────────────────────────
async function scrapeDomain(key: string, cfg: DomainConfig, query: string): Promise<IslamicResult[]> {
  const urls = await searchSite(cfg.host, query, 2);
  const pages = await Promise.allSettled(urls.map((u) => fetchAndExtract(u)));

  const out: IslamicResult[] = [];
  pages.forEach((p, i) => {
    if (p.status !== "fulfilled" || !p.value) return;
    const url = urls[i];
    const { title, text } = p.value;
    const content = title ? `**${title}**\n\n${text.slice(0, 3_500)}` : text.slice(0, 3_500);
    const citationExtras = cfg.citation?.(url) ?? {};
    out.push({
      domain: key,
      content,
      citation_ref: { ...citationExtras, url } as any,
      language: cfg.lang,
    });
  });
  return out;
}

/**
 * Exported so the request logic is reachable from a test — see
 * islamic-api-fetch/index.ts's comment for why the HTTP layer is split out
 * of the anonymous `serve()` callback this way.
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
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
      targets.map((key) => scrapeDomain(key, DOMAINS[key], query)),
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
