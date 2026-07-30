// Claim segmentation now lives in shared/ (SPEC-M5 FR-1.5/FR-3.4) as
// segmentText/TextSegment — see shared/text/chunk.ts for the algorithm and
// its rationale. Re-exported under this file's original names so existing
// importers (research-query/index.ts) keep working unchanged.
export { segmentText as segmentClaims } from "../../../shared/text/chunk.ts";
export type { TextSegment as ClaimSegment } from "../../../shared/text/chunk.ts";

/** Detect dominant script of a segment for downstream language-aware lookups. */
export function detectScript(text: string): "ar" | "ur" | "en" | "mixed" {
  const arabicCount = (text.match(/[؀-ۿ]/g) ?? []).length;
  const urduOnly = /[ٹڈڑںھہۂۃیے۔چ]/.test(text);
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  if (urduOnly && arabicCount > latinCount) return "ur";
  if (arabicCount > latinCount && arabicCount > 3) return "ar";
  if (latinCount > arabicCount && latinCount > 3) return "en";
  return "mixed";
}
