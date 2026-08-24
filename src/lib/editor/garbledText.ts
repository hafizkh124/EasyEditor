/**
 * Detects text destroyed by a broken font/encoding mapping ("mojibake").
 *
 * Some books in the corpus were extracted from PDFs that use a custom-encoded
 * font — the glyphs render as Arabic on screen, but the underlying codepoints
 * are Latin, so extraction yields runs like:
 *
 *   Z 355< H c 9 sd 6 U 7 f K < M d 2 Q L jb c R % 9 ZB& X !j 3 ,= d |q x Q
 *
 * A row like that is worthless as a citation and actively harmful in a
 * scholarly tool: it carries a real-looking reference ("Tajweedi-Qaida,
 * p. 1487") attached to nonsense, and one click inserts it into the user's
 * document as a blockquote.
 *
 * This is deliberately a *display-time* guard, not a data migration. The
 * damage is a class of problem (any PDF-sourced book can carry it, and future
 * ingests can reintroduce it), so filtering on the way out protects every
 * affected book at once — including ones nobody has enumerated yet.
 *
 * **Bias: keep the row.** A false positive silently hides real scholarship,
 * which is far worse than letting one garbled row through. Every threshold
 * below is set so that anything remotely plausible survives, mirroring the
 * same "return null rather than guess" discipline as
 * `supabase/functions/_shared/resultIdentity.ts`.
 */

/** Arabic, Arabic Supplement, Extended-A, and both Presentation Forms blocks
 *  — covers Arabic and Urdu alike, since Urdu is written in Arabic script.
 *  Written as \u escapes rather than pasted characters: the literal form ends
 *  at U+FEFF, which is an invisible no-break space that lint (rightly) rejects
 *  and that no reader could have spotted in review. */
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LETTER_RE = /[\p{L}]/gu;

/** Below this length there is not enough signal to judge; keep it. */
const MIN_LENGTH = 40;

/** Any real Arabic/Urdu content at or above this share is never garbled —
 *  extraction damage replaces the script entirely, it does not thin it out. */
const ARABIC_KEEP_RATIO = 0.15;

/** Mojibake fragments into stray single characters. Normal prose — English
 *  included — sits far below this. */
const MIN_SINGLE_CHAR_TOKEN_RATIO = 0.4;

/** …and is dense with punctuation/symbols that prose never reaches. */
const MIN_SYMBOL_RATIO = 0.08;

function count(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * True only when the text is confidently unreadable. Callers should treat
 * `false` as "show it" — including for every input this cannot judge.
 */
export function isGarbledText(text: string | null | undefined): boolean {
  const s = (text ?? "").trim();
  if (s.length < MIN_LENGTH) return false;

  const letters = count(s, LETTER_RE);
  if (letters === 0) return false; // digits/symbols only — not our call to make

  // Real Arabic or Urdu present in any meaningful share → keep, always.
  if (count(s, ARABIC_RE) / letters >= ARABIC_KEEP_RATIO) return false;

  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return false;

  const singleCharTokens = tokens.filter((t) => t.length === 1).length;
  const symbols = count(s, /[^\p{L}\p{N}\s]/gu);

  return (
    singleCharTokens / tokens.length >= MIN_SINGLE_CHAR_TOKEN_RATIO &&
    symbols / s.length >= MIN_SYMBOL_RATIO
  );
}
