/**
 * Single-page call to the `translate-page` edge function, shared by Quick
 * Translate (`useTranslation.ts`) and the whole-book translator
 * (`useBookTranslation.ts`). Extracted so the SSE-parsing logic lives in one
 * place instead of being duplicated between the two.
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

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("text/event-stream")) {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") break;
        try {
          const parsed = JSON.parse(payload);
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) {
            accumulated += chunk;
            onChunk?.(accumulated);
          }
        } catch { /* skip malformed lines */ }
      }
    }

    return accumulated;
  }

  const data = await response.json();
  const finalText = data.translation || data.text || "";
  onChunk?.(finalText);
  return finalText;
}
