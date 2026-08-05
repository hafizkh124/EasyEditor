// Shamela full-text lookup for the reference dialog (SPEC-M5 FR-5, SPEC-M5.9 FR-3).
//
// Two routes, one result shape:
//
//   desktop → window.electronAPI.shamela.search, which runs Shamela's own
//             Lucene index through its own JRE in the main process (ADR-0007)
//   web     → the tools/shamela-bridge HTTP sidecar on 127.0.0.1
//
// The native route is what makes SPEC-M5's headline promise true: a clean
// machine with only Shamela 4 and EasyEditor installed, no sidecar, no .bat.
// The HTTP route stays for the web build, which has no main process to ask.
//
// Neither route spends tokens — this is a literal index search, not a
// retrieval-augmented one (FR-3.3).

import type { ResourceResult } from "@/lib/editor/citationFormat";
import { isDesktop } from "@/core/backend";

export interface LocalShamelaSearchResponse {
  status: string;
  total_hits: number;
  results: Array<{
    book_id: number | null;
    book_name: string;
    author_name: string | null;
    volume: number | null;
    page: string | number | null;
    content: string;
    highlighted: string | null;
  }>;
}

/** One normalized hit, before it becomes a ResourceResult. */
interface ShamelaHit {
  bookId: string | number | null;
  bookName: string;
  authorName?: string | null;
  volume?: number | null;
  page?: string | number | null;
  content: string;
}

function cleanText(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Shared by both routes so a citation reads the same whichever one produced
 * it — `reason` and `match_key` are what useResourceSearch buckets on.
 */
function toResourceResults(hits: ShamelaHit[]): ResourceResult[] {
  return hits.map((hit, idx) => {
    const parsedPage = hit.page != null ? parseInt(String(hit.page), 10) : undefined;
    const bookName = cleanText(hit.bookName);
    const authorName = hit.authorName ? cleanText(hit.authorName) : undefined;

    return {
      content: cleanText(hit.content),
      source_type: "hadith",
      reason: bookName ? `مکتبہ شاملہ (آف لائن) — ${bookName}` : "مکتبہ شاملہ (آف لائن)",
      citation_ref: {
        book: bookName || undefined,
        scholar: authorName || undefined,
        page: parsedPage === undefined || Number.isNaN(parsedPage) ? undefined : parsedPage,
        ...(hit.volume != null ? { volume: hit.volume } : {}),
      },
      match_key: `shamela-${hit.bookId ?? "raw"}-${hit.page ?? 0}-${idx}`,
    } as ResourceResult;
  });
}

/**
 * Desktop route. Errors propagate: shamelaNative reports precisely why it
 * could not search (no JRE, no store index, Shamela holding a file lock), and
 * risk R15 is that the user sees an empty result instead of that reason.
 */
async function searchViaNative(query: string, limit: number): Promise<ResourceResult[]> {
  const results = await window.electronAPI!.shamela.search(query, limit);
  return toResourceResults(
    (results || []).map((r) => ({
      bookId: r.bookId,
      bookName: r.bookTitle,
      page: r.pageNumber,
      content: r.snippet,
    })),
  );
}

/** Web route — the HTTP sidecar. Unreachable is not an error, just no hits. */
async function searchViaBridge(query: string, limit: number): Promise<ResourceResult[]> {
  const isConnected = localStorage.getItem("shamela.connected") === "1";
  if (!isConnected) return [];

  const rawUrl = localStorage.getItem("shamela.mcp_url") || "http://127.0.0.1:8000";
  const baseUrl = rawUrl.replace(/\/+$/, "");

  const res = await fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  }).catch(() => null);

  if (!res || !res.ok) return [];

  const data: LocalShamelaSearchResponse = await res.json();
  if (!data.results || !Array.isArray(data.results)) return [];

  return toResourceResults(
    data.results.map((item) => ({
      bookId: item.book_id,
      bookName: item.book_name,
      authorName: item.author_name,
      volume: item.volume,
      page: item.page,
      content: item.content || item.highlighted || "",
    })),
  );
}

/**
 * "Shamela isn't installed" is a normal state for most desktop users, not a
 * search failure — it must not raise a toast on every lookup. Real
 * diagnostics (missing JRE, missing store index, file lock) still propagate.
 */
function isShamelaNotInstalled(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('انسٹال نہیں');
}

export async function searchLocalShamela(query: string, limit = 20): Promise<ResourceResult[]> {
  if (isDesktop() && window.electronAPI?.shamela) {
    // Errors other than "not installed" are deliberately re-thrown:
    // useResourceSearch pairs this with the cloud lookup, and a real
    // diagnostic ("Shamela's JRE was not found") must reach the user rather
    // than be flattened into zero results.
    try {
      return await searchViaNative(query, limit);
    } catch (err) {
      if (isShamelaNotInstalled(err)) return [];
      throw err;
    }
  }

  try {
    return await searchViaBridge(query, limit);
  } catch (err) {
    console.error("[searchLocalShamela] Error querying local bridge:", err);
    return [];
  }
}
