/**
 * Detects whether the given text contains RTL (right-to-left) script characters.
 * Covers Arabic, Arabic Supplement, Arabic Extended-A, Arabic Presentation Forms A & B.
 */
export function isRtlText(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
    text.slice(0, 100)
  );
}
