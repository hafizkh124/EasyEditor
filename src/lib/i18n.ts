import enTranslations from "@/locales/en.json";
import urTranslations from "@/locales/ur.json";
import arTranslations from "@/locales/ar.json";
import { logger } from "@/lib/logger";

const log = logger.child("i18n");

export type Language = "en" | "ur" | "ar";
export type TranslationKey = keyof typeof enTranslations;
export type Translator = (key: TranslationKey, fallback?: string) => string;
export type TranslationValues = Record<string, string | number>;

const translationMap: Record<Language, Record<string, string>> = {
  en: enTranslations,
  ur: urTranslations,
  ar: arTranslations,
};

const warnedMissingKeys = new Set<string>();

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "ur" || value === "ar";
}

export function translate(language: Language, key: TranslationKey, fallback?: string): string {
  const localValue = translationMap[language]?.[key];
  const translated = localValue ?? translationMap.en[key] ?? fallback;

  if (import.meta.env.DEV && localValue === undefined) {
    const warningKey = `${language}:${key}`;
    if (!warnedMissingKeys.has(warningKey)) {
      warnedMissingKeys.add(warningKey);
      // Missing keys must be visible during development, but only once.
      log.warn("missing translation", { language, key });
    }
  }

  if (translated !== undefined) return translated;
  return key;
}

export function getStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem("easyeditor-lang");
  return isLanguage(saved) ? saved : "en";
}

export function translateStored(key: TranslationKey, fallback?: string): string {
  return translate(getStoredLanguage(), key, fallback);
}

export function formatTranslation(template: string, values: TranslationValues): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
}

export function translateStoredFormat(key: TranslationKey, values: TranslationValues): string {
  return formatTranslation(translateStored(key), values);
}
