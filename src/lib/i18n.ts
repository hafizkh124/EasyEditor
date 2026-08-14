import enTranslations from "@/locales/en.json";
import urTranslations from "@/locales/ur.json";
import arTranslations from "@/locales/ar.json";
import { logger } from "@/lib/logger";

const log = logger.child("i18n");

/** Mirrors APP_THEME_STORAGE_KEY in src/lib/theme.ts — the app's storage-key pattern. */
export const APP_LANG_STORAGE_KEY = "easyeditor-lang";

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
  const saved = window.localStorage.getItem(APP_LANG_STORAGE_KEY);
  return isLanguage(saved) ? saved : "en";
}

/**
 * True once the user has explicitly chosen a language (any of the three), so
 * the first-run chooser can be skipped on every later visit. A URL locale
 * prefix (/ur, /ar) is handled by LanguageContext, not by this gate.
 */
export function hasChosenLanguage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(APP_LANG_STORAGE_KEY) !== null;
  } catch {
    // Privacy mode can make localStorage unavailable; treat as not chosen.
    return false;
  }
}

export function persistLanguage(lang: Language): void {
  try {
    window.localStorage.setItem(APP_LANG_STORAGE_KEY, lang);
  } catch {
    // Non-fatal — LanguageContext still applies the language for this session.
  }
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
