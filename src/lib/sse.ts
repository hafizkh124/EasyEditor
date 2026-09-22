/**
 * Shared consumer for the OpenAI-compatible SSE streams our edge functions
 * return (`translate-page`, `research-query`, `islamic-search`).
 *
 * Several of those functions respond with `Content-Type: text/event-stream`,
 * so calling `res.json()` — or `supabase.functions.invoke()`, which parses the
 * body as JSON — silently yields nothing. Callers that only need the finished
 * text should use `collectSseText` instead of re-implementing the loop.
 *
 * Used by `translatePageApi.ts`; kept here so callers to any of these edge
 * functions don't duplicate (and subtly diverge from) this parsing.
 */

/**
 * Reads an SSE response to completion and returns the concatenated
 * `choices[0].delta.content`. Non-streaming JSON responses are handled too, so
 * a caller works whether or not the function streams.
 *
 * @param onChunk optional progress callback, receives the accumulated text.
 */
export async function collectSseText(
  response: Response,
  onChunk?: (accumulated: string) => void,
): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("text/event-stream")) {
    // Non-streaming fallback: accept the common response shapes.
    const data = await response.json().catch(() => ({}));
    return (
      data?.text ??
      data?.translation ??
      data?.refined ??
      data?.choices?.[0]?.message?.content ??
      ""
    );
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
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
      if (payload === "[DONE]") return accumulated;
      try {
        const parsed = JSON.parse(payload);
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) {
          accumulated += chunk;
          onChunk?.(accumulated);
        }
      } catch {
        /* skip malformed lines */
      }
    }
  }

  return accumulated;
}
