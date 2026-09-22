import { collectSseText } from "@/lib/sse";

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
  accessToken: string;
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
