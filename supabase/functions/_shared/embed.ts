// Canonical query-time embedder for scholarly_documents.
//
// MUST match the model + dimensionality that backfill-embeddings used to
// embed the corpus (gemini-embedding-001 @ 768 dims — see
// supabase/functions/backfill-embeddings/index.ts). If a caller embeds a
// query with a different model, the resulting vector lands in a different
// space than the stored vectors: cosine similarity against
// match_scholarly_documents becomes meaningless and every search silently
// returns zero results (no error — just empty).
//
// This is exactly what happened before this file existed: refine-text and
// ingest-scholarly-data both called the retired "text-embedding-004" model,
// while every working search path (resource-search, vector-search,
// backfill-embeddings, islamic-health) called "gemini-embedding-001"
// directly. Route every query-time embedding call through here so that
// mismatch can't recur.
//
// The constants themselves now live in shared/ (M5), so the Electron main
// process embeds into the very same vector space as this Deno function.
// Re-exported here so existing importers keep working unchanged.
export { EMBED_MODEL, EMBED_DIMS } from "../../../shared/ai/embedConstants.ts";
import { EMBED_MODEL, EMBED_DIMS } from "../../../shared/ai/embedConstants.ts";

/**
 * Embed a single query string via Google's native embedContent endpoint.
 * Returns null (never throws) on any failure so callers can fall back to
 * lexical-only retrieval instead of hard-failing the whole request.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    console.warn("[embed] GEMINI_API_KEY missing — semantic channel disabled");
    return null;
  }

  const call = () =>
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": geminiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: (text ?? "").trim() || " " }] },
          outputDimensionality: EMBED_DIMS,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

  try {
    let res = await call();
    if (!res.ok && res.status >= 500 && res.status < 600) {
      console.warn("[embed] embedContent 5xx, retrying once:", res.status);
      res = await call();
    }
    if (!res.ok) {
      console.error("[embed] embedContent error:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const values: number[] = data?.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBED_DIMS) {
      console.error("[embed] unexpected embedding shape:", data);
      return null;
    }
    return values;
  } catch (e) {
    console.error("[embed] embedQuery exception:", e);
    return null;
  }
}

/**
 * Embed up to 100 texts in one call via batchEmbedContents. Used by bulk
 * ingest paths. Unlike embedQuery, this THROWS on failure — bulk ingest jobs
 * need to know a batch failed so they can retry/abort, rather than silently
 * writing rows with no embedding.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) throw new Error("GEMINI_API_KEY not configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;
  const requests = texts.map((t) => ({
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text: t || " " }] },
    outputDimensionality: EMBED_DIMS,
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": geminiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const arr = data?.embeddings;
  if (!Array.isArray(arr)) throw new Error("Unexpected embedding response shape");
  return arr.map((e: any) => e.values as number[]);
}
