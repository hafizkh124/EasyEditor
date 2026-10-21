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
  | "summarize"
  | "summarize_sections";

const SUPPORTED_REFINE_TEXT_ACTIONS = new Set<RefineTextAction>([
  "formalize",
  "humanize",
  "shorten",
  "citations",
  "spelling_check",
  "normalize_script",
  "add_harakat",
  "auto_format",
  "paraphrase",
  "summarize",
  "summarize_sections",
]);

export function isRefineTextAction(action: string): action is RefineTextAction {
  return SUPPORTED_REFINE_TEXT_ACTIONS.has(action as RefineTextAction);
}

/**
 * Largest payload `refine-text` accepts (FR-9.3). The edge function enforces the
 * same number; it lives here as a constant so the chunker (M3.4) sizes its
 * batches against one definition rather than a second copied literal.
 */
export const MAX_REFINE_CHARS = 12000;

/** A retrieved source, exactly as `refine-text` returns it (SPEC-M3 FR-4.1). */
export interface RefineTextSource {
  domain: string;
  reference: string;
  source_url: string | null;
  snippet: string;
  score: number;
  channels: string[];
}

export interface RefineTextResult {
  text: string;
  /** Present for citation runs; empty for every other action. */
  sources: RefineTextSource[];
  /** 0–1 for citation runs, `null` when the action produces no confidence. */
  confidence: number | null;
  model: string | null;
  tokensUsed: number | null;
}

/**
 * Calls refine-text and returns the refined output plus its provenance.
 *
 * Use this when the caller records a task_run — `callRefineText` throws away
 * `sources`/`confidence`/`model`, which is what the Trust UI needs.
 */
export async function callRefineTextDetailed(
  text: string,
  action: RefineTextAction,
  accessToken: string,
  /**
   * `ai_tasks.id` for a user-authored task. Only the id travels — the server
   * looks the prompt up under the caller's own user_id (FR-2.5).
   */
  taskId?: string,
): Promise<RefineTextResult> {
  const sourceText = text.trim();
  if (!sourceText) {
    return { text: "", sources: [], confidence: null, model: null, tokensUsed: null };
  }

  if (sourceText.length > MAX_REFINE_CHARS) {
    throw new Error("دستاویز بڑی ہے — متن منتخب کریں، یا حصہ بہ حصہ چلائیں۔");
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-text`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ text: sourceText, action, task_id: taskId }),
    },
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Request failed (${response.status})`);
  }

  const data = await response.json();
  return {
    text: data.text ?? "",
    sources: Array.isArray(data.sources) ? data.sources : [],
    // An older deployment of the function returns neither field; `null` keeps
    // "not reported" distinct from "reported as zero".
    confidence: typeof data.confidence === "number" ? data.confidence : null,
    model: typeof data.model === "string" ? data.model : null,
    tokensUsed: typeof data.tokens_used === "number" ? data.tokens_used : null,
  };
}

/**
 * Text-only convenience wrapper, kept because the Translator and the
 * flag-off editor path only ever need the refined string.
 */
export async function callRefineText(
  text: string,
  action: RefineTextAction,
  accessToken: string,
): Promise<string> {
  const result = await callRefineTextDetailed(text, action, accessToken);
  return result.text;
}
