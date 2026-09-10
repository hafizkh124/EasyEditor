/**
 * Plan §3.4 — calendar-relative grouping for history lists. Extracted verbatim
 * from `SidebarHistory.tsx` so the rail `HistoryPanel` and the legacy sidebar
 * share one implementation.
 */
import type { TranslationKey } from "@/lib/i18n";

export type DateBucket = "today" | "yesterday" | "last_week" | "older";

export const BUCKET_ORDER: DateBucket[] = ["today", "yesterday", "last_week", "older"];

export const BUCKET_LABEL_KEY: Record<DateBucket, TranslationKey> = {
  today: "sidebar.group_today",
  yesterday: "sidebar.group_yesterday",
  last_week: "sidebar.group_last_week",
  older: "sidebar.group_older",
};

/** Classify a timestamp into a calendar-relative bucket (local time). */
export function bucketFor(iso: string): DateBucket {
  const d = new Date(iso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 86400000);
  if (d >= startOfToday) return "today";
  if (d >= startOfYesterday) return "yesterday";
  if (d >= startOfWeek) return "last_week";
  return "older";
}

/** Short "5m" / "3h" / "2d" then a locale date. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((Date.now() - then) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return `${abs}s`;
  if (abs < 3600) return `${Math.round(abs / 60)}m`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h`;
  if (abs < 604800) return `${Math.round(abs / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

/** Group an already-sorted-desc list by bucket, dropping empty buckets. */
export function groupByBucket<T>(items: T[], isoOf: (item: T) => string): Array<{ bucket: DateBucket; rows: T[] }> {
  return BUCKET_ORDER
    .map((bucket) => ({ bucket, rows: items.filter((i) => bucketFor(isoOf(i)) === bucket) }))
    .filter((g) => g.rows.length > 0);
}
