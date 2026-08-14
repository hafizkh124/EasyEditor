import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import {
  getStoredLanguage,
  persistLanguage,
  translate,
  type Language,
  type TranslationKey,
  type Translator,
} from "@/lib/i18n";
type Direction = "ltr" | "rtl";

interface LanguageContextType {
  language: Language;
  direction: Direction;
  setLanguage: (lang: Language) => void;
  t: Translator;
}

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  direction: "ltr",
  setLanguage: () => {},
  t: (key, fallback) => translate("en", key, fallback),
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    // URL takes precedence: /ar/... → ar
    if (typeof window !== "undefined") {
      const seg = window.location.pathname.split("/").filter(Boolean)[0];
      if (seg === "ar") return "ar";
      if (seg === "ur") return "ur";
    }
    return getStoredLanguage();
  });

  const direction: Direction = language === "ur" || language === "ar" ? "rtl" : "ltr";

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    persistLanguage(lang);
  }, []);

  const t = useCallback(
    (key: TranslationKey, fallback?: string): string => translate(language, key, fallback),
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
