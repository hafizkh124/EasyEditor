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
  quran: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  hadith: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  tafsir: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  shamela: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
};
