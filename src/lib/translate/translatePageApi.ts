import { collectSseText } from "@/lib/sse";
import { usesOwnKey } from "@/lib/pages/pageEngine";

/**
 * Single-page call to the `translate-page` edge function — the request
 * shape `useBookTranslation.ts` (and, before it was retired, Quick
 * Translate's `useTranslation.ts`) needs. Response parsing itself is
 * `collectSseText` (`src/lib/sse.ts`), the shared reader every SSE-returning
 * edge function call should use instead of re-implementing the loop.
 */

export interface TranslateOnePageArgs {
  /** Plain text to translate (e.g. a Shamela page, or Quick Translate's text mode). */
  text?: string;
  /** Base64 page image to translate (e.g. a rendered PDF page). */
  imageBase64?: string;
  mimeType?: string;
  targetLanguage: string;
  /** Omit/undefined for auto-detect. */
  sourceLanguage?: string;
  /** A GENRE_TRANSLATION_PROMPTS entry's `prompt` (tafsir/fiqh/hadith/lughat). */
  genreInstruction?: string;
  /** True inside a whole-book run — charges the cheaper `translate_book` rate. */
  bookMode?: boolean;
  /** The signed-in session's token, for the cloud route; unused with the desktop's own key. */
  accessToken?: string;
  signal?: AbortSignal;
  /** Called with the accumulated text as streamed chunks arrive. */
  onChunk?: (accumulated: string) => void;
}

/** Resolves with the final translated text once the stream (or JSON response) completes. */
export async function translateOnePage({
  text,
  imageBase64,
  mimeType,
  targetLanguage,
  sourceLanguage,
  genreInstruction,
  bookMode,
  accessToken,
  signal,
  onChunk,
}: TranslateOnePageArgs): Promise<string> {
  const body: Record<string, unknown> = {
    targetLanguage,
    sourceLanguage: sourceLanguage || undefined,
    genreInstruction: genreInstruction || undefined,
    bookMode: bookMode || undefined,
  };

  if (imageBase64) {
    body.imageBase64 = imageBase64;
    body.mimeType = mimeType || "image/jpeg";
  } else if (text) {
    body.text = text;
  }

  // The desktop with the user's own key translates locally (SYSTEM-2026 §10).
  if (await usesOwnKey()) return translateWithOwnKey(body, signal, onChunk);

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-page`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal,
    },
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const err = new Error(errData.error || `Translation failed (${response.status})`);
    if (response.status === 429) err.name = "RateLimitError";
    throw err;
  }

  return collectSseText(response, onChunk);
}

/** The desktop's own-key route: the main process streams chunks back on a one-off channel. */
async function translateWithOwnKey(
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onChunk: ((accumulated: string) => void) | undefined,
): Promise<string> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const api = window.electronAPI!;
  const streamChannelId = `translate-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let accumulated = "";
  const stop = api.byok?.onStreamChunk(streamChannelId, (data) => {
    if (data.chunk) {
      accumulated += data.chunk;
      onChunk?.(accumulated);
    }
  });
  try {
    const call = api.invoke("ai:invoke", { mode: "edge-function", functionName: "translate-page", body, streamChannelId }) as Promise<{
      data?: { text?: string };
    }>;
    // An abort stops waiting here; the main-process call finishes on its own.
    const aborted = new Promise<never>((_, reject) =>
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }),
    );
    const result = await Promise.race([call, aborted]);
    return result?.data?.text ?? accumulated;
  } catch (err) {
    if (err instanceof Error && /429|درخواستیں بہت تیز/.test(err.message)) err.name = "RateLimitError";
    throw err;
  } finally {
    stop?.();
  }
}
