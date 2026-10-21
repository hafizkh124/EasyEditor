import type { SourceFilter } from "./useResourceSearch";

/**
 * Per-source colour identity for the resource-search filter chips and result
 * badges, so a source reads at a glance instead of needing the label read
 * every time. Same idiom the rest of the app already uses for chip colour
 * (`bg-X-500/10 text-X-700 dark:text-X-400 border-X-500/20` —
 * src/lib/citations/hadithGrade.ts's `GRADE_FAMILY_STYLE`), applied per
 * source rather than per hadith grade. "all" has no colour of its own —
 * it's the neutral/no-filter state.
 */
export const SOURCE_CHIP_STYLE: Partial<Record<SourceFilter, string>> = {
  quran: "bg-success/10 text-success border-success/20",
  hadith: "bg-info/10 text-info border-info/20",
  tafsir: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  shamela: "bg-warning/10 text-warning border-warning/20",
};
