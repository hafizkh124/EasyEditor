/**
 * Detect the dominant text direction of a string — RTL for Arabic/Urdu script,
 * LTR for Latin/English. Used by the reader so that Arabic, Urdu and English
 * books all render correctly regardless of which language the app UI is in.
 *
 * SPEC-M6 Phase 3: "Arabic-first, not Arabic-only — full RTL support, but Urdu
 * and English content must render correctly."
 */

export type TextDirection = "rtl" | "ltr";

// Strong RTL characters: Hebrew, Arabic, Arabic Supplement, Arabic Extended,
// and Arabic Presentation Forms (the ranges Shamela content actually uses).
const RTL_RE = /[\u0591-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;

// Strong LTR characters: ASCII letters + Latin-1 Supplement + Latin Extended.
const LTR_RE = /[A-Za-z\u00C0-\u024F]/;

/**
 * Count strong-direction characters, ignoring markup, digits and punctuation
 * (digits are weak and take the direction of surrounding text).
 */
export function detectTextDirection(input: string): TextDirection {
  if (!input) return "rtl";
  const text = input.replace(/<[^>]+>/g, " ");

  let rtl = 0;
  let ltr = 0;
  for (const ch of text) {
    if (RTL_RE.test(ch)) rtl += 1;
    else if (LTR_RE.test(ch)) ltr += 1;
  }

  // Fall back to RTL for Arabic libraries when the sample is ambiguous
  // (e.g. a page of only numbers or punctuation).
  return ltr > rtl ? "ltr" : "rtl";
}

/**
 * Merge the user's direction preference with auto-detection. An explicit
 * choice always wins; "auto" lets the page's own script decide.
 */
export function effectiveDirection(
  preference: "auto" | TextDirection,
  pageText: string,
): TextDirection {
  return preference === "auto" ? detectTextDirection(pageText) : preference;
}
