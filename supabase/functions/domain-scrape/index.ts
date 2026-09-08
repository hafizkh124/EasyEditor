/**
 * domain-scrape — Tier C: live scraping of Islamic fatwa/Q&A / classical sites.
 *
 * Reimplemented free (no Firecrawl, no API key) after the paid Firecrawl
 * version was retired 2026-09-08. Two-step pipeline per domain:
 *   1. Find 1-2 candidate pages. Tries the site's OWN search box first
 *      (`SITE_SEARCH`, below) — live-verified 2026-09-08 to be the more
 *      reliable source, since the free search engines are the actual weak
 *      link (DuckDuckGo bot-blocks datacentre IPs; Bing serves results but
 *      silently drops the `site:` operator). Falls back to Bing/DuckDuckGo
 *      (`SEARCH_ENGINES`) for every site without a working native search.
 *      Replaces Firecrawl's `/v2/search`.
 *   2. A plain `fetch` of each candidate with a browser-like User-Agent,
 *      parsed with linkedom and reduced to its main article text with a
 *      lightweight readability heuristic — this replaces Firecrawl's
 *      `scrapeOptions: { formats: ['markdown'], onlyMainContent: true }`.
 *
 * Response shape (unchanged): `{ results: IslamicResult[] }` (+ optional
 * `diagnostics` when the caller passes `debug: true` — see ScrapeDiagnostic).
 *
 * Trade-off vs. Firecrawl: no JS rendering and no anti-bot handling. A host
 * that requires either returns zero results through every path here (the
 * per-domain try/catch degrades to `[]`, same as before) rather than error —
 * `darulifta-deoband.com` was dropped from `DOMAINS` entirely for exactly
 * this reason (403s a direct fetch, not just search) rather than left as
 * permanent dead weight in the fan-out.
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

// ── Step 1: free web search, scoped to one site ─────────────────────────────
// Search engines never link straight at the result; each wraps it in its own
// redirector, and this unwraps both shapes we meet:
//   DuckDuckGo — //duckduckgo.com/l/?uddg=<url-encoded target>&rut=…
//   Bing       — /ck/a?…&u=a1<base64url of the target>&ntb=1
// A plain http(s) href is passed through unchanged.
function unwrapSearchLink(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.hostname.endsWith("duckduckgo.com") && u.pathname === "/l/") {
      const target = u.searchParams.get("uddg");
      return target ? decodeURIComponent(target) : null;
    }
    if (u.hostname.endsWith("bing.com") && u.pathname === "/ck/a") {
      const raw = u.searchParams.get("u");
      if (!raw || !raw.startsWith("a1")) return null;
      let b64 = raw.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      b64 += "=".repeat((4 - (b64.length % 4)) % 4);
      try {
        const decoded = atob(b64);
        return decoded.startsWith("http") ? decoded : null;
      } catch {
        return null;
      }
    }
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Free web search, tried in order.
 *
 * Bing is FIRST on purpose. DuckDuckGo's HTML/lite endpoints answer a
 * datacentre IP — which is exactly what an edge function is — with HTTP 202 and
 * an anomaly page carrying no results at all, verified live from this project's
 * own function; they stay only as a fallback in case that ever relaxes. Bing
 * answers 200 with real result markup from the same IPs.
 *
 * Every anchor on the page is considered and then filtered by host: the engines
 * rewrite their result classes often, so the host check — not a CSS selector —
 * is what guarantees correctness.
 */
const SEARCH_ENGINES: Array<{
  name: string;
  base: string;
  build: (q: string) => { url: string; init: RequestInit };
}> = [
  {
    name: "bing",
    base: "https://www.bing.com",
    build: (q) => ({
      url: `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
      init: { headers: { "User-Agent": BROWSER_UA } },
    }),
  },
  {
    name: "ddg-html",
    base: "https://duckduckgo.com",
    build: (q) => ({
      url: "https://html.duckduckgo.com/html/",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": BROWSER_UA },
        body: new URLSearchParams({ q }),
      },
    }),
  },
  {
    name: "ddg-lite",
    base: "https://duckduckgo.com",
    build: (q) => ({
      url: "https://lite.duckduckgo.com/lite/",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": BROWSER_UA },
        body: new URLSearchParams({ q }),
      },
    }),
  },
];

function hostMatches(url: string, host: string): boolean {
  try {
    // Strip `www.` from BOTH sides: two registry entries store the host WITH the
    // prefix ("www.islamweb.net", "www.islamicurdubooks.com"), so a one-sided
    // strip silently rejected every result those two sites ever returned.
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const want = host.toLowerCase().replace(/^www\./, "");
    return h === want || h.endsWith("." + want);
  } catch {
    return false;
  }
}

async function searchOn(
  engine: (typeof SEARCH_ENGINES)[number],
  host: string,
  query: string,
  limit: number,
): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const { url, init } = engine.build(`site:${host} ${query}`);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    // 202 is DuckDuckGo's bot-anomaly response — technically `ok`, always empty.
    if (!res.ok || res.status === 202) {
      console.error(`[domain-scrape] ${engine.name} HTTP ${res.status} for ${host}`);
      return [];
    }

    const html = await res.text();
    const { document: doc } = parseHTML(html);

    const urls: string[] = [];
    const seen = new Set<string>();
    for (const a of Array.from(doc.querySelectorAll("a"))) {
      const href = a.getAttribute("href");
      if (!href) continue;
      const real = unwrapSearchLink(href, engine.base);
      if (!real || seen.has(real) || !hostMatches(real, host)) continue;
      seen.add(real);
      urls.push(real);
      if (urls.length >= limit) break;
    }
    if (urls.length === 0) {
      console.error(`[domain-scrape] ${engine.name} returned 0 links for ${host} (${html.length} bytes)`);
    }
    return urls;
  } catch (e) {
    clearTimeout(timeout);
    console.error(`[domain-scrape] ${engine.name} failed for ${host}:`, (e as Error).message);
    return [];
  }
}

// ── Step 1b: the site's OWN search box ──────────────────────────────────────
// Measured live from this function on 2026-09-08: the free engines are the
// weak link, not the sites. DuckDuckGo answers a datacentre IP with HTTP 202
// and an empty anomaly page, and Bing answers 200 but silently DROPS the
// `site:` operator, returning results from unrelated domains. Every site here,
// by contrast, answers its own search URL with real result markup.
//
// `pattern` picks the detail pages out of the search page. Where a site has no
// distinctive detail URL shape (WordPress pretty permalinks), we instead diff
// the search page's links against the home page's — whatever is NOT chrome is
// a result. The home page is fetched once per function instance and cached.
interface SiteSearch {
  url: (q: string) => string;
  pattern?: RegExp;
  /** Home page used for the chrome diff when `pattern` is absent. */
  home?: string;
}

const SITE_SEARCH: Record<string, SiteSearch> = {
  // Deliberately NOT here, each checked live on 2026-09-08:
  //   islamqa.info          — search results are rendered client-side; the HTML
  //                           carries no /answers/<id> link at all.
  //   www.islamweb.net      — same; its search page exposes only category ids.
  //   magazine.mohaddis.com — has no search endpoint (?s=, /search, /Home/Search
  //                           all 404 or fall back to the latest-articles list),
  //                           so it would return the same articles every query.
  // darulifta-deoband.com isn't listed here OR in DOMAINS above at all —
  // it 403s this pipeline's User-Agent on a direct fetch too (not just
  // search), so no path through this file can ever reach it. Removed
  // 2026-09-08 rather than left as permanent dead weight in the fan-out.
  "alulama.org": {
    url: (q) => `https://alulama.org/?s=${encodeURIComponent(q)}`,
    home: "https://alulama.org/",
  },
  "islamfort.com": {
    url: (q) => `https://islamfort.com/?s=${encodeURIComponent(q)}`,
    home: "https://islamfort.com/",
  },
  // Diagnosed live 2026-09-08. The earlier "HTTP 500 to any search request"
  // was NOT a block: urdufatwa is a Laravel app, not WordPress, and `?s=`
  // crashes its HomeController ("Undefined array key 2"). Its real search is
  // GET /frontend-search with search_cat=2 (عمومی تلاش), search_tag=<query>,
  // sEnType=website (internal engine, not Google), sType=OR. Verified: 200,
  // ~160 KB, with detail links shaped /view/<catId>/<fatwaId>/<slug>.
  // search_cat MUST be present — without it the route 404s.
  "urdufatwa.com": {
    url: (q) =>
      `https://urdufatwa.com/frontend-search?search_cat=2&search_tag=${encodeURIComponent(q)}&sEnType=website&sType=OR`,
    pattern: /\/view\/\d+\/\d+\//,
  },
  // shamilaurdu.com is NOT here: its 500 is a WAF ("You have been blocked due
  // to suspicious activity detected from your browser"), returned for the
  // HOME PAGE too, not just search — no path through this file can reach it.
};

const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|ttf|xml|pdf|zip|mp3|mp4)$/i;
const homeLinkCache = new Map<string, Set<string>>();

async function pageLinks(url: string, host: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA }, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      // First ~300 chars of the body — a server error page usually names the
      // actual cause (missing param, a PHP fatal, a WAF challenge page, …)
      // where the status code alone doesn't.
      const snippet = await res.text().then((t) => t.slice(0, 300)).catch(() => "<unreadable body>");
      console.error(`[domain-scrape] site search HTTP ${res.status} for ${host} — url=${url} body=${JSON.stringify(snippet)}`);
      return [];
    }
    const { document: doc } = parseHTML(await res.text());
    const out: string[] = [];
    for (const a of Array.from(doc.querySelectorAll("a"))) {
      const href = a.getAttribute("href");
      if (!href) continue;
      let abs: URL;
      try {
        abs = new URL(href, url);
      } catch {
        continue;
      }
      if (!hostMatches(abs.toString(), host)) continue;
      if (ASSET_RE.test(abs.pathname)) continue;
      out.push(abs.origin + abs.pathname);
    }
    return [...new Set(out)];
  } catch (e) {
    clearTimeout(timeout);
    console.error(`[domain-scrape] site search failed for ${host}:`, (e as Error).message);
    return [];
  }
}

async function searchNative(host: string, query: string, limit: number): Promise<string[]> {
  const cfg = SITE_SEARCH[host];
  if (!cfg) return [];

  const found = await pageLinks(cfg.url(query), host);
  if (found.length === 0) return [];

  if (cfg.pattern) {
    return found.filter((u) => cfg.pattern!.test(u)).slice(0, limit);
  }

  let chrome = homeLinkCache.get(host);
  if (!chrome) {
    chrome = new Set(await pageLinks(cfg.home ?? `https://${host}/`, host));
    homeLinkCache.set(host, chrome);
  }
  return found.filter((u) => !chrome!.has(u) && !u.includes("/search")).slice(0, limit);
}

async function searchSite(host: string, query: string, limit: number): Promise<string[]> {
  const native = await searchNative(host, query, limit);
  if (native.length > 0) return native;
  for (const engine of SEARCH_ENGINES) {
    const urls = await searchOn(engine, host, query, limit);
    if (urls.length > 0) return urls;
  }
  return [];
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
/** Per-domain trace, filled only when the caller passes `debug: true`. */
export interface ScrapeDiagnostic {
  domain: string;
  urls: string[];
  extracted: number;
}

async function scrapeDomain(
  key: string,
  cfg: DomainConfig,
  query: string,
  diag?: ScrapeDiagnostic[],
): Promise<IslamicResult[]> {
  const urls = await searchSite(cfg.host, query, 2);
  const pages = await Promise.allSettled(urls.map((u) => fetchAndExtract(u)));
  if (diag) {
    diag.push({
      domain: key,
      urls,
      extracted: pages.filter((p) => p.status === "fulfilled" && p.value).length,
    });
  }

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
    const { query, selectedDomains, debug } = await req.json();
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

    const diagnostics: ScrapeDiagnostic[] | undefined = debug === true ? [] : undefined;
    const settled = await Promise.allSettled(
      targets.map((key) => scrapeDomain(key, DOMAINS[key], query, diagnostics)),
    );

    const results: IslamicResult[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(...r.value);
    }

    return new Response(JSON.stringify(diagnostics ? { results, diagnostics } : { results }), {
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
