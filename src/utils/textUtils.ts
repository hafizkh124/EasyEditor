/**
 * Detects whether the given text contains RTL (right-to-left) script characters.
 * Covers Arabic, Arabic Supplement, Arabic Extended-A, Arabic Presentation Forms A & B.
 *
 * The implementation now lives in shared/ so Deno and Node see the same one.
 * Note this is the *presence* test (any RTL char in the first 100) —
 * src/utils/arabicUtils.ts exports a same-named function that tests
 * *dominance* (>30%). The two are not interchangeable; see scriptRuns.ts.
 */
export { hasRtlChars as isRtlText } from "~shared/text/scriptRuns";
