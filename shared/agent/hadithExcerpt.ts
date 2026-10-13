/**
 * The passage a `search_hadith` result carries into the agent's tool result and
 * the citation panel.
 *
 * Until now both dispatchers kept only the reference label and URL from
 * `islamic-search`'s citations, so the Ask mode's source panel showed bare
 * chips even though the server was sending the text. A corpus row's `content`
 * is often the Urdu translation and the Arabic matn sits in `content_ar`, so
 * the two are carried separately and the panel can put the Arabic first.
 *
 * Pure — no runtime globals.
 */

/** Per-field cap in the tool result (the model also reads these). */
export const EXCERPT_MAX = 350;
/** Cap for the ledger's copy (claim-check reads it). */
export const LEDGER_CONTENT_MAX = 1200;

const clip = (s: string | undefined, max: number): string | undefined => {
  const t = (s ?? '').trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
};

export interface PassageSource {
  content?: string;
  content_ar?: string;
}

export interface ExcerptFields {
  /** Ledger text: Arabic matn first, then the translation. */
  content?: string;
  /** Translation / main text (omitted when it equals the Arabic). */
  excerpt?: string;
  /** Arabic matn. */
  excerpt_ar?: string;
}

export function excerptFields(c: PassageSource): ExcerptFields {
  const ar = (c.content_ar ?? '').trim();
  const main = (c.content ?? '').trim();
  const other = main && main !== ar ? main : '';
  const out: ExcerptFields = {};
  const ledger = clip([ar, other].filter(Boolean).join('\n'), LEDGER_CONTENT_MAX);
  if (ledger) out.content = ledger;
  const e = clip(other || (ar ? '' : main), EXCERPT_MAX);
  if (e) out.excerpt = e;
  const a = clip(ar, EXCERPT_MAX);
  if (a) out.excerpt_ar = a;
  return out;
}
