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
import type { ChunkSearchHit } from "@/core/backend/types";
import { isDesktop } from "@/core/backend";
import { getBridgeToken } from "@/core/shamela/shamelaClient";
import { logger } from "@/lib/logger";

const log = logger.child("localShamelaService");

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
      source_type: "shamela",
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
  return toResourceResults(await nativeHits(query, limit));
}

async function nativeHits(query: string, limit: number): Promise<ShamelaHit[]> {
  const results = await window.electronAPI!.shamela.search(query, limit);
  return (results || []).map((r) => ({
    bookId: r.bookId,
    bookName: r.bookTitle,
    page: r.pageNumber,
    content: r.snippet,
  }));
}

/** Web route — the HTTP sidecar. Unreachable is not an error, just no hits. */
async function searchViaBridge(query: string, limit: number): Promise<ResourceResult[]> {
  return toResourceResults(await bridgeHits(query, limit));
}

async function bridgeHits(query: string, limit: number): Promise<ShamelaHit[]> {
  const isConnected = localStorage.getItem("shamela.connected") === "1";
  if (!isConnected) return [];

  const rawUrl = localStorage.getItem("shamela.mcp_url") || "http://127.0.0.1:8000";
  const baseUrl = rawUrl.replace(/\/+$/, "");

  const token = getBridgeToken();
  const res = await fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Bridge-Token": token } : {}),
    },
    body: JSON.stringify({ query, limit }),
  }).catch(() => null);

  if (!res || !res.ok) return [];

  const data: LocalShamelaSearchResponse = await res.json();
  if (!data.results || !Array.isArray(data.results)) return [];

  return data.results.map((item) => ({
    bookId: item.book_id,
    bookName: item.book_name,
    authorName: item.author_name,
    volume: item.volume,
    page: item.page,
    content: item.content || item.highlighted || "",
  }));
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
    log.error("Error querying local bridge", { err });
    return [];
  }
}

/**
 * Same two routes, shaped for the Library's Shamela search tab.
 *
 * That tab used to call `libraryItemService.searchChunks`, which searches only
 * books already imported into the workspace — and whose cloud implementation is
 * a stub returning nothing, so on web the tab could never show a result at all.
 * Sitting inside the Shamela tab it should search Shamela, which is exactly what
 * these routes already do for the editor's reference dialog.
 *
 * `itemId` carries the Shamela book id so a result opens in the reader the same
 * way a BrowseTab book does.
 */
export async function searchShamelaAsChunks(query: string, limit = 50): Promise<ChunkSearchHit[]> {
  const hits = isDesktop() && window.electronAPI?.shamela
    ? await nativeHits(query, limit)
    : await bridgeHits(query, limit);

  return hits.map((hit, idx) => {
    const parsedPage = hit.page != null ? parseInt(String(hit.page), 10) : NaN;
    return {
      itemId: String(hit.bookId ?? ""),
      title: cleanText(hit.bookName),
      sourceRef: {
        book: cleanText(hit.bookName),
        ...(hit.authorName ? { scholar: cleanText(hit.authorName) } : {}),
        ...(hit.volume != null ? { volume: hit.volume } : {}),
      },
      pageNumber: Number.isNaN(parsedPage) ? null : parsedPage,
      content: cleanText(hit.content),
      rank: idx,
    };
  });
}
