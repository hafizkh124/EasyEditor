import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import enTranslations from "@/locales/en.json";
import urTranslations from "@/locales/ur.json";
import arTranslations from "@/locales/ar.json";

type Language = "en" | "ur" | "ar";
type Direction = "ltr" | "rtl";

export type TranslationKey = keyof typeof enTranslations;

interface LanguageContextType {
  language: Language;
  direction: Direction;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey | string) => string;
}

const translationMap: Record<Language, Record<string, string>> = {
  en: enTranslations,
  ur: urTranslations,
  ar: arTranslations,
};

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  direction: "ltr",
  setLanguage: () => {},
  t: (key: string) => key,
});

export const useLanguage = () => useContext(LanguageContext);

const isLanguage = (v: unknown): v is Language => v === "en" || v === "ur" || v === "ar";

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    // URL takes precedence: /ar/... → ar
    if (typeof window !== "undefined") {
      const seg = window.location.pathname.split("/").filter(Boolean)[0];
      if (seg === "ar") return "ar";
      if (seg === "ur") return "ur";
    }
    const saved = localStorage.getItem("easyeditor-lang");
    return isLanguage(saved) ? saved : "en";
  });

  const direction: Direction = language === "ur" || language === "ar" ? "rtl" : "ltr";

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("easyeditor-lang", lang);
  }, []);

  const t = useCallback(
    (key: TranslationKey | string): string => {
      const dict = translationMap[language] ?? translationMap.en ?? {};
      const value = dict[key];
      if (value) return value;
      const enValue = translationMap.en?.[key];
      return enValue ?? key;
    },
    [language]
  );

  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = language;
  }, [direction, language]);

  const value = useMemo(
    () => ({ language, direction, setLanguage, t }),
    [language, direction, setLanguage, t]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};
