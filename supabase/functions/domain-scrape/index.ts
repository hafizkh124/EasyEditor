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
  if (domain === "dar-alifta") {
    // Pattern: /fatawa/1234 or /ViewFatwa.aspx?ID=1234
    const m1 = url.match(/\/fatawa\/(\d+)/i);
    if (m1) return m1[1];
    const m2 = url.match(/[?&](?:ID|id|FatwaId)=(\d+)/i);
    return m2?.[1] ?? "";
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

// ── Dar-Alifta.org ────────────────────────────────────────────────────────────
async function scrapeDarAlifta(query: string): Promise<IslamicResult[]> {
  const searchUrl = `https://dar-alifta.org/ar/search?q=${encodeURIComponent(query)}`;
  const html = await fetchWithTimeout(searchUrl);
  if (!html) return [];

  const links = extractLinks(html, "https://dar-alifta.org",
    /href="(\/ar\/(?:fatawa|ViewFatwa)[^"]*\d+[^"]*)"/);
  if (links.length === 0) return [];

  const results: IslamicResult[] = [];

  for (const link of links.slice(0, 2)) {
    const fullLink = link.startsWith("http") ? link : `https://dar-alifta.org${link}`;
    const pageHtml = await fetchWithTimeout(fullLink);
    if (!pageHtml) continue;

    // Layer 1
    const fatwaNumber = extractFatwaNumberFromUrl(fullLink, "dar-alifta");

    const content = extractSection(pageHtml, ".FatwaText") ||
      stripHtml(pageHtml.match(/<div[^>]*class="[^"]*FatwaText[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "").slice(0, 3_000);

    if (!content) continue;

    // Layer 2 + 3 (Arabic content)
    let scholar = extractScholarFromHtml(pageHtml);
    if (!scholar) scholar = extractScholarFromText(content);

    results.push({
      domain: "dar-alifta",
      content,
      citation_ref: {
        fatwa_number: fatwaNumber || undefined,
        scholar:      scholar || undefined,
        url:          fullLink,
      } as any,
      language: "ar",
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
    if (!selectedDomains || selectedDomains.includes("islamqa"))    scrapers.push(scrapeIslamQA(query));
    if (!selectedDomains || selectedDomains.includes("islamweb"))   scrapers.push(scrapeIslamWeb(query));
    if (!selectedDomains || selectedDomains.includes("dar-alifta")) scrapers.push(scrapeDarAlifta(query));

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
