/**
 * domain-scrape — Tier C: Live scraping of Islamic fatwa/Q&A sites
 *
 * Three-layer citation extraction per source:
 *   Layer 1 — URL regex: fatwa number from URL pattern (fastest, most reliable)
 *   Layer 2 — DOM regex: scholar name from common HTML patterns in page content
 *   Layer 3 — Text regex: scan scraped text for attribution phrases when L1+L2 fail
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import type { IslamicResult } from "../islamic-api-fetch/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; IslamicResearchBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ar,en;q=0.9",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return "";
    return await res.text();
  } catch (e: any) {
    clearTimeout(timeoutId);
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// ── Layer 1: URL regex fatwa number ──────────────────────────────────────────
function extractFatwaNumberFromUrl(url: string, domain: string): string {
  if (domain === "islamqa") {
    const m = url.match(/\/answers\/(\d+)\//);
    return m?.[1] ?? "";
  }
  if (domain === "islamweb") {
    const m = url.match(/FatwaId=(\d+)/i);
    return m?.[1] ?? "";
  }
  return "";
}

// ── Layer 2: DOM regex scholar extraction ─────────────────────────────────────
// Scans raw HTML for common scholar-name patterns across islamqa/islamweb/dar-alifta
function extractScholarFromHtml(html: string): string {
  // islamqa.info: <span class="sheikh-name">...</span> or data-author
  const patterns: RegExp[] = [
    /<span[^>]*class="[^"]*sheikh[^"]*"[^>]*>(.*?)<\/span>/i,
    /<span[^>]*class="[^"]*scholar[^"]*"[^>]*>(.*?)<\/span>/i,
    /<span[^>]*class="[^"]*author[^"]*"[^>]*>(.*?)<\/span>/i,
    /<div[^>]*class="[^"]*sheikh[^"]*"[^>]*>(.*?)<\/div>/i,
    /<div[^>]*class="[^"]*mufti[^"]*"[^>]*>(.*?)<\/div>/i,
    /<meta[^>]*name="author"[^>]*content="([^"]+)"/i,
    /data-author="([^"]+)"/i,
    // islamweb: answered by section
    /<td[^>]*class="[^"]*answeredby[^"]*"[^>]*>(.*?)<\/td>/i,
    // Arabic: الشيخ followed by name
    /الشيخ[:\s]+([^\n<،,.(]{3,60})/,
    /أجاب[^:]*:\s*([^\n<،,.]{3,60})/,
  ];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) {
      const name = stripHtml(m[1]).trim();
      if (name.length >= 3 && name.length <= 80) return name;
    }
  }
  return "";
}

// ── Layer 3: Plain-text attribution scan ─────────────────────────────────────
// Last resort: scan the stripped text content for English/Arabic attribution phrases
function extractScholarFromText(text: string): string {
  const patterns: RegExp[] = [
    /(?:answered|responded|fatwa) by[:\s]+([A-Za-z\s.'-]{3,60}?)(?:\.|,|\n)/i,
    /(?:Sheikh|Shaykh|Dr\.|Prof\.)\s+([A-Za-z\s.'-]{3,50}?)(?:\.|,|\n)/,
    /scholar[:\s]+([A-Za-z\s.'-]{3,50}?)(?:\.|,|\n)/i,
    /mufti[:\s]+([A-Za-z\s.'-]{3,50}?)(?:\.|,|\n)/i,
    // Arabic attribution
    /الشيخ\s+([^\n،,.(]{4,50})/,
    /أجاب\s+عنه\s+([^\n،,.(]{4,50})/,
    /المفتي\s*:\s*([^\n،,.(]{4,50})/,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) {
      const name = m[1].trim();
      if (name.length >= 3 && name.length <= 80) return name;
    }
  }
  return "";
}

function extractSection(html: string, selector: string): string {
  const patterns: Record<string, RegExp[]> = {
    ".answer-txt": [
      /<div[^>]*class="[^"]*answer-txt[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i,
      /<div[^>]*id="[^"]*answer[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i,
    ],
    ".fatwa-content": [
      /<div[^>]*class="[^"]*fatwa-content[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i,
      /<div[^>]*class="[^"]*FatwaContent[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i,
    ],
    ".FatwaText": [
      /<div[^>]*class="[^"]*FatwaText[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i,
      /<div[^>]*class="[^"]*fatwa-text[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i,
    ],
    ".question-title": [
      /<h[123][^>]*class="[^"]*question-title[^"]*"[^>]*>([\s\S]*?)<\/h[123]>/i,
      /<h[123][^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h[123]>/i,
    ],
  };
  const plist = patterns[selector] ?? [];
  for (const pattern of plist) {
    const match = html.match(pattern);
    if (match?.[1]) return stripHtml(match[1]).slice(0, 3_000);
  }
  return "";
}

function extractLinks(html: string, baseUrl: string, pattern: RegExp): string[] {
  const links: string[] = [];
  let match;
  const re = new RegExp(pattern.source, "gi");
  while ((match = re.exec(html)) !== null) {
    try {
      const href = match[1];
      const full = href.startsWith("http") ? href : new URL(href, baseUrl).href;
      links.push(full);
    } catch {
      // skip invalid URLs
    }
  }
  return [...new Set(links)].slice(0, 3);
}

// ── IslamQA.info ─────────────────────────────────────────────────────────────
async function scrapeIslamQA(query: string): Promise<IslamicResult[]> {
  const searchUrl = `https://islamqa.info/en/search?q=${encodeURIComponent(query)}&lang=en`;
  const html = await fetchWithTimeout(searchUrl);
  if (!html) return [];

  const links = extractLinks(html, "https://islamqa.info", /href="(\/en\/answers\/\d+\/[^"]*?)"/);
  if (links.length === 0) return [];

  const results: IslamicResult[] = [];

  for (const link of links.slice(0, 2)) {
    const pageHtml = await fetchWithTimeout(link);
    if (!pageHtml) continue;

    // Layer 1: fatwa number from URL
    const fatwaNumber = extractFatwaNumberFromUrl(link, "islamqa");

    // Extract title
    const title = stripHtml(pageHtml.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1] ?? "").slice(0, 200);

    // Extract content
    const content = extractSection(pageHtml, ".answer-txt") ||
      extractSection(pageHtml, ".question-title") ||
      stripHtml(pageHtml.match(/<div[^>]*id="[^"]*answer[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "").slice(0, 3_000);

    if (!content) continue;

    // Layer 2: scholar from DOM
    let scholar = extractScholarFromHtml(pageHtml);
    // Layer 3: scholar from text (fallback)
    if (!scholar) scholar = extractScholarFromText(content);

    results.push({
      domain: "islamqa",
      content: title ? `**${title}**\n\n${content}` : content,
      citation_ref: {
        fatwa_number: fatwaNumber || undefined,
        scholar:      scholar || undefined,
        url:          link,
      } as any,
      language: "en",
    });
  }

  return results;
}

// ── IslamWeb.net ──────────────────────────────────────────────────────────────
async function scrapeIslamWeb(query: string): Promise<IslamicResult[]> {
  const searchUrl = `https://www.islamweb.net/en/fatwa/search/?q=${encodeURIComponent(query)}`;
  const html = await fetchWithTimeout(searchUrl);
  if (!html) return [];

  const links = extractLinks(html, "https://www.islamweb.net", /href="([^"]*FatwaId=\d+[^"]*)"/);
  if (links.length === 0) return [];

  const results: IslamicResult[] = [];

  for (const link of links.slice(0, 2)) {
    const pageHtml = await fetchWithTimeout(link);
    if (!pageHtml) continue;

    // Layer 1
    const fatwaNumber = extractFatwaNumberFromUrl(link, "islamweb");

    const content = extractSection(pageHtml, ".fatwa-content") ||
      stripHtml(pageHtml.match(/<div[^>]*class="[^"]*fatwa[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "").slice(0, 3_000);

    if (!content) continue;

    // Layer 2 + 3
    let scholar = extractScholarFromHtml(pageHtml);
    if (!scholar) scholar = extractScholarFromText(content);

    results.push({
      domain: "islamweb",
      content,
      citation_ref: {
        fatwa_number: fatwaNumber || undefined,
        scholar:      scholar || undefined,
        url:          link,
      } as any,
      language: "en",
    });
  }

  return results;
}

// ── Dar-Alifta.org — removed per Phase 7.5 doctrine (persistent timeouts).
//    Reinstate scrapeDarAlifta here if the upstream becomes reliable again.

// ── ShamilaUrdu.com (Phase 8.3) — DEFERRED ────────────────────────────────────
// Public-facing pages are static (URL patterns like /hadith/<slug>/<N>/ and
// /book/<slug>/<page>/), but the search endpoint /?s=… rejects bot-shaped
// requests with `SECURITY_ERROR_BAD_INPUT`. Re-enabling this scraper requires
// either:
//   (a) discovering an unprotected search endpoint via browser DevTools, OR
//   (b) using a search-engine fallback (DuckDuckGo `site:shamilaurdu.com` query)
//       to find result URLs and then fetching the static pages directly.
// Leave the stub in place so the wiring is obvious when we come back to it.
async function scrapeShamilaUrdu(_query: string): Promise<IslamicResult[]> {
  return [];
}

// ── IslamicUrduBooks.com (Phase 8.2) ─────────────────────────────────────────
// Static HTML PHP site. 38 hadith collections in Arabic + Urdu. Search at
// /hadith/search_urdu.php?q=<term> yields links to /hadith/hadith-.php?bookid=X&hadith_number=Y
//
// Defensive parsing: we don't know exact CSS class names, so we use multiple
// strategies — URL-param extraction for the structured fields, and a
// content-density heuristic for the Arabic / Urdu body. If the site reshuffles
// markup, parsing degrades gracefully (returns whatever was extractable).
async function scrapeIslamicUrduBooks(query: string): Promise<IslamicResult[]> {
  const base = "https://www.islamicurdubooks.com";
  const searchUrl = `${base}/hadith/search_urdu.php?q=${encodeURIComponent(query)}`;
  const html = await fetchWithTimeout(searchUrl, 12_000);
  if (!html) return [];

  // Result links follow the pattern: hadith-.php?bookid=N&hadith_number=M
  // (we accept both relative `./hadith-...` and absolute `https://...` forms).
  const links = extractLinks(
    html,
    base,
    /href="((?:\.{0,2}\/)?(?:hadith\/)?hadith-\.php\?bookid=\d+&(?:hadith_number|hadithno)=\d+[^"]*)"/i,
  );
  if (links.length === 0) return [];

  const results: IslamicResult[] = [];

  // Map bookid → book name. The full list lives on the site; we hardcode the
  // common ones so citations get readable book names. Unknown ids fall back
  // to "Book <N>" so the citation still works.
  const BOOK_NAMES: Record<string, string> = {
    "1":  "صحيح البخاري",
    "2":  "صحيح مسلم",
    "3":  "سنن أبي داود",
    "4":  "جامع الترمذي",
    "5":  "سنن النسائي",
    "6":  "سنن ابن ماجه",
    "7":  "موطأ الإمام مالك",
    "8":  "مسند أحمد",
    "9":  "سنن الدارمي",
    "10": "صحيح ابن خزيمة",
    "11": "صحيح ابن حبان",
    "12": "المستدرك للحاكم",
    "13": "السنن الكبرى للبيهقي",
  };

  for (const link of links.slice(0, 3)) {
    const pageHtml = await fetchWithTimeout(link, 12_000);
    if (!pageHtml) continue;

    // ─ Structured ids from URL ────────────────────────────────────────
    const bookId = link.match(/bookid=(\d+)/i)?.[1] ?? "";
    const hadithNumber = link.match(/(?:hadith_number|hadithno)=(\d+)/i)?.[1] ?? "";
    if (!bookId || !hadithNumber) continue;

    // ─ Title from H1 ──────────────────────────────────────────────────
    const h1 = pageHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
    const title = stripHtml(h1).slice(0, 200);

    // ─ Body content: take all <p>, <div class*="hadith"|"text"|"matn">,
    //   <font>, <span class*="arabic"|"urdu"> blocks and concatenate. ──
    const bodyParts: string[] = [];
    const blockRe = /<(?:p|div|font|span)[^>]*>([\s\S]*?)<\/(?:p|div|font|span)>/gi;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(pageHtml)) !== null && bodyParts.length < 30) {
      const txt = stripHtml(m[1]);
      // Heuristic: keep blocks that have ≥ 25 chars and contain at least one
      // Arabic or Urdu character. Drops nav/footer/script blocks.
      if (txt.length >= 25 && /[؀-ۿ]/.test(txt)) {
        bodyParts.push(txt);
      }
    }
    // Dedupe consecutive duplicates from nested tags
    const body = [...new Set(bodyParts)].join("\n\n").slice(0, 3_500);
    if (!body) continue;

    const bookName = BOOK_NAMES[bookId] ?? `Book ${bookId}`;

    results.push({
      domain: "islamicurdubooks",
      content: title ? `**${title}**\n\n${body}` : body,
      citation_ref: {
        book:          bookName,
        hadith_number: hadithNumber,
        url:           link.startsWith("http") ? link : `${base}/${link.replace(/^\.{0,2}\//, "")}`,
      } as any,
      language: "ur",
    });
  }

  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const { query, selectedDomains } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const scrapers: Promise<IslamicResult[]>[] = [];
    if (!selectedDomains || selectedDomains.includes("islamqa"))           scrapers.push(scrapeIslamQA(query));
    if (!selectedDomains || selectedDomains.includes("islamweb"))          scrapers.push(scrapeIslamWeb(query));
    if (!selectedDomains || selectedDomains.includes("islamicurdubooks")) scrapers.push(scrapeIslamicUrduBooks(query));

    const settled = await Promise.allSettled(scrapers);
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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
