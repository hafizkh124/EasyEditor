/**
 * Country-agnostic WhatsApp number helpers.
 *
 * We don't restrict to any single country. The form just needs a number that
 * looks plausibly like a phone number — 7 to 20 digits, optionally prefixed
 * with `+`. Spaces, dashes, parentheses, and dots are stripped on the way in.
 */

const MIN_DIGITS = 7;
const MAX_DIGITS = 20;

/**
 * Sanitize and validate a raw WhatsApp number string. Returns the cleaned
 * value (digits, optionally prefixed with `+`) or `null` if it doesn't look
 * like a valid phone number.
 */
export function normalizeWhatsAppNumber(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Build a click-to-message WhatsApp link. wa.me requires digits only, no `+`.
 */
export function buildWhatsAppLink(number: string, message?: string): string {
  const digits = number.replace(/[^\d]/g, "");
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
