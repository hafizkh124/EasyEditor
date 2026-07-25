import type { ResourceResult } from "@/lib/editor/citationFormat";

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

function cleanText(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export async function searchLocalShamela(query: string, limit = 20): Promise<ResourceResult[]> {
  try {
    const isConnected = localStorage.getItem("shamela.connected") === "1";
    if (!isConnected) return [];

    const rawUrl = localStorage.getItem("shamela.mcp_url") || "http://127.0.0.1:8000";
    const baseUrl = rawUrl.replace(/\/+$/, "");

    const res = await fetch(`${baseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit }),
    }).catch(() => null);

    if (!res || !res.ok) return [];

    const data: LocalShamelaSearchResponse = await res.json();
    if (!data.results || !Array.isArray(data.results)) return [];

    const mapped: ResourceResult[] = [];
    for (let idx = 0; idx < data.results.length; idx++) {
      const item = data.results[idx];
      const parsedPage = item.page != null ? parseInt(String(item.page), 10) : undefined;
      const cleanContent = cleanText(item.content || item.highlighted || "");
      const cleanBookName = cleanText(item.book_name);
      const cleanAuthorName = item.author_name ? cleanText(item.author_name) : undefined;

      mapped.push({
        content: cleanContent,
        source_type: "hadith",
        reason: cleanBookName ? `مکتبہ شاملہ (آف لائن) — ${cleanBookName}` : "مکتبہ شاملہ (آف لائن)",
        citation_ref: {
          book: cleanBookName || undefined,
          scholar: cleanAuthorName || undefined,
          page: Number.isNaN(parsedPage) ? undefined : parsedPage,
        },
        match_key: `shamela-${item.book_id || "raw"}-${item.page || 0}-${idx}`,
      });
    }

    return mapped;
  } catch (err) {
    console.error("[searchLocalShamela] Error querying local bridge:", err);
    return [];
  }
}
