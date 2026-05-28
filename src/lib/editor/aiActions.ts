/**
 * Shared client helpers for calling the `refine-text` edge function from the
 * Editor and Translator. The function is non-streaming and returns `{ text }`.
 *
 * Actions supported by refine-text:
 *   formalize | humanize | shorten | citations | spelling_check |
 *   normalize_script | add_harakat | auto_format
 *
 * `auto_format` returns an HTML fragment; all other actions return plain text.
 */
export type RefineTextAction =
  | "formalize"
  | "humanize"
  | "shorten"
  | "citations"
  | "spelling_check"
  | "normalize_script"
  | "add_harakat"
  | "auto_format"
  | "paraphrase"
  | "summarize";

/**
 * Calls refine-text and returns the refined output (text or HTML, depending on
 * the action). Throws on HTTP / network errors with a human-readable message.
 */
export async function callRefineText(
  text: string,
  action: RefineTextAction,
  accessToken: string,
): Promise<string> {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-text`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ text, action }),
    },
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Request failed (${response.status})`);
  }

  const data = await response.json();
  return data.text ?? "";
}
