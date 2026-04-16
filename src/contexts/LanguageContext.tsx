import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import enTranslations from "@/locales/en.json";
import urTranslations from "@/locales/ur.json";

type Language = "en" | "ur";
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
};

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  direction: "ltr",
  setLanguage: () => {},
  t: (key: string) => key,
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem("easyeditor-lang") as Language | null;
    return saved === "en" || saved === "ur" ? saved : "en";
  });

  const direction: Direction = language === "ur" ? "rtl" : "ltr";

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("easyeditor-lang", lang);
  }, []);

  const t = useCallback(
    (key: TranslationKey | string): string => {
      const dict = translationMap[language] ?? translationMap.en ?? {};
      const value = dict[key];
      if (value) return value;
      // Fallback to English if current language is missing the key
      const enValue = translationMap.en?.[key];
      return enValue ?? key;
    },
    [language]
  );

  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = language === "ur" ? "ur" : "en";
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
