import { useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Dates were formatted with `toLocaleDateString(undefined, …)`, which follows
 * the BROWSER language, so an Urdu screen showed "Oct 22" and the admin table
 * "22/10/2026". They now follow the app language. Latin digits and the Gregorian
 * calendar are kept on purpose: the rest of the app (counts, tokens) uses Latin
 * digits, and `ar` would otherwise default to Hijri in some regions.
 */
const LOCALE_TAG: Record<string, string> = {
  ur: "ur-PK-u-nu-latn",
  ar: "ar-u-ca-gregory-nu-latn",
  en: "en-US",
};

export type DateStyle = "short" | "date" | "datetime";

const OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { month: "short", day: "numeric" },
  date: { year: "numeric", month: "short", day: "numeric" },
  datetime: { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
};

export function formatDateFor(language: string, value: string | number | Date, style: DateStyle = "short"): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(LOCALE_TAG[language] ?? LOCALE_TAG.en, OPTIONS[style]).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Formatter bound to the current app language. */
export function useFormatDate() {
  const { language } = useLanguage();
  return useCallback(
    (value: string | number | Date, style: DateStyle = "short") => formatDateFor(language, value, style),
    [language],
  );
}
