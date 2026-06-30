import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Three-way locale string helper. Used for inline UI text (nav labels,
 * inline marketing copy) where adding a translation-key for every string
 * would be overkill. Returns the value matching the active language.
 */
export function useTri(): (en: string, ur: string, ar: string) => string {
  const { language } = useLanguage();
  return (en, ur, ar) =>
    language === "ar" ? ar : language === "ur" ? ur : en;
}

export function triLang(
  lang: "en" | "ur" | "ar",
  en: string,
  ur: string,
  ar: string,
): string {
  return lang === "ar" ? ar : lang === "ur" ? ur : en;
}
