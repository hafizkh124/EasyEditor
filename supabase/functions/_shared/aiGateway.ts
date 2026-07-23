// Unified AI gateway with Gemini-direct primary + Lovable AI fallback.
//
// Strategy: try Google's OpenAI-compatible Gemini endpoint first (cheap,
// direct), and on non-2xx / network failure, fall back to Lovable AI Gateway
// (same OpenAI shape, different auth + base URL).
//
// Both providers speak the same chat-completions request/response schema, so
// callers pass a single OpenAI-style body and receive a `Response` whose
// `.body` they can read or stream.

import { embedQuery, embedBatch } from "./embed.ts";

const GEMINI_BASE   = "https://generativelanguage.googleapis.com/v1beta/openai";
const LOVABLE_BASE  = "https://ai.gateway.lovable.dev/v1";

/** Strip the `google/` provider prefix the Lovable gateway expects so the
 *  request is valid against Google's native endpoint. Other providers stay
 *  as-is (and will only work through the Lovable fallback). */
function toGeminiModel(model: string): string {
  return model.startsWith("google/") ? model.slice("google/".length) : model;
}

export interface ChatCompletionsBody {
  model: string;
  // deno-lint-ignore no-explicit-any
  messages: any[];
  stream?: boolean;
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
}

export interface CallChatOptions {
  /** If true, fall through to Lovable even on success-but-empty responses. */
  signal?: AbortSignal;
}

/** Status codes that should trigger a fallback to Lovable. Anything else is
 *  a deterministic error (bad request, auth) and re-running won't help. */
function shouldFallback(status: number): boolean {
  // 429 rate-limit, 402 quota exhausted, 5xx upstream, 404 model unavailable.
  return status === 429 || status === 402 || status === 404 || status >= 500;
}

/**
 * Call chat-completions with Gemini-direct primary and Lovable fallback.
 * Returns the raw `Response` from whichever provider succeeded (or the last
 * failure response if both fail).
 */
export async function callChatCompletions(
  body: ChatCompletionsBody,
  opts: CallChatOptions = {},
): Promise<Response> {
  const geminiKey  = Deno.env.get("GEMINI_API_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");

  // ── Primary: Gemini direct (OpenAI-compatible endpoint) ──────────────────
  if (geminiKey) {
    try {
      const geminiBody = { ...body, model: toGeminiModel(body.model) };
      const res = await fetch(`${GEMINI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${geminiKey}`,
          "Content-Type": "application/json",
        },
        body:   JSON.stringify(geminiBody),
        signal: opts.signal,
      });
      if (res.ok) return res;
      if (!shouldFallback(res.status)) return res; // deterministic error
      // Drain so the connection can be reused.
      await res.body?.cancel().catch(() => {});
      console.warn(`[aiGateway] Gemini ${res.status} — falling back to Lovable`);
    } catch (e) {
      console.warn("[aiGateway] Gemini fetch threw — falling back:", e);
    }
  }

  // ── Fallback: Lovable AI Gateway ────────────────────────────────────────
  if (!lovableKey) {
    return new Response(
      JSON.stringify({ error: "No AI provider configured (GEMINI_API_KEY and LOVABLE_API_KEY both missing)" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  return await fetch(`${LOVABLE_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${lovableKey}`,
      "Content-Type": "application/json",
    },
    body:   JSON.stringify(body),
    signal: opts.signal,
  });
}

/**
 * Embeddings — delegates to `embed.ts` (embedQuery / embedBatch) so every
 * caller lands in the SAME vector space as scholarly_documents, regardless
 * of what `model` string they pass in. `body.model` is intentionally
 * ignored: this used to be a foot-gun where a caller could request the
 * retired "text-embedding-004" and silently get zero search results (wrong
 * vector space, not an error) instead of a visible failure. See embed.ts.
 *
 * Returns an OpenAI-embeddings-shaped Response so existing callers that do
 * `(await res.json()).data[i].embedding` keep working unchanged.
 */
export async function callEmbeddings(body: {
  model: string;
  input: string | string[];
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
}): Promise<Response> {
  try {
    if (Array.isArray(body.input)) {
      const vectors = await embedBatch(body.input);
      return new Response(
        JSON.stringify({ data: vectors.map((embedding, index) => ({ embedding, index })) }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const vector = await embedQuery(body.input);
    if (!vector) {
      return new Response(
        JSON.stringify({ error: "Embedding failed — see function logs" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ data: [{ embedding: vector, index: 0 }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[aiGateway] callEmbeddings error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
