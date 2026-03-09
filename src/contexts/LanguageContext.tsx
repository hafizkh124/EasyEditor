import React, { createContext, useContext, useState, useEffect } from "react";

type Language = "en" | "ur";
type Direction = "ltr" | "rtl";

interface LanguageContextType {
  language: Language;
  direction: Direction;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    "nav.home": "Home",
    "nav.transcribe": "Transcribe",
    "nav.settings": "Settings",
    "dashboard.welcome": "Welcome to EasyEditor",
    "dashboard.subtitle": "Your AI-powered research & editing toolkit",
    "dashboard.usage": "Usage",
    "dashboard.seconds_used": "seconds used",
    "dashboard.of": "of",
    "dashboard.unlimited": "Unlimited",
    "dashboard.upgrade": "Upgrade to Pro",
    "dashboard.coming_soon": "Coming Soon",
    "dashboard.research_assistant": "AI Research Assistant",
    "dashboard.ocr": "Image to Text (OCR)",
    "dashboard.tts": "Text to Speech (TTS)",
    "stt.title": "Speech to Text",
    "stt.start": "Start Recording",
    "stt.stop": "Stop Recording",
    "stt.language": "Language",
    "stt.transcript": "Transcript",
    "stt.copy": "Copy",
    "stt.download": "Download",
    "stt.no_transcript": "Press the mic button to start transcribing...",
    "stt.recording": "Recording...",
    "stt.processing": "Processing...",
    "stt.limit_reached": "Free tier limit reached. Upgrade to Pro for unlimited access.",
    "settings.title": "Settings",
    "settings.profile": "Profile",
    "settings.display_name": "Display Name",
    "settings.language": "Preferred Language",
    "settings.subscription": "Subscription",
    "settings.current_plan": "Current Plan",
    "settings.free": "Free",
    "settings.pro": "Pro",
    "settings.save": "Save Changes",
    "settings.logout": "Log Out",
    "auth.login": "Log In",
    "auth.signup": "Sign Up",
    "auth.email": "Email",
    "auth.password": "Password",
    "auth.forgot_password": "Forgot Password?",
    "auth.no_account": "Don't have an account?",
    "auth.have_account": "Already have an account?",
    "auth.google": "Continue with Google",
    "auth.reset_password": "Reset Password",
    "auth.new_password": "New Password",
    "auth.send_reset": "Send Reset Link",
    "auth.back_to_login": "Back to Log In",
  },
  ur: {
    "nav.home": "ہوم",
    "nav.transcribe": "ٹرانسکرائب",
    "nav.settings": "ترتیبات",
    "dashboard.welcome": "ایزی ایڈیٹر میں خوش آمدید",
    "dashboard.subtitle": "آپ کا AI سے چلنے والا ریسرچ اور ایڈیٹنگ ٹول کٹ",
    "dashboard.usage": "استعمال",
    "dashboard.seconds_used": "سیکنڈ استعمال ہوئے",
    "dashboard.of": "میں سے",
    "dashboard.unlimited": "لامحدود",
    "dashboard.upgrade": "پرو میں اپ گریڈ کریں",
    "dashboard.coming_soon": "جلد آ رہا ہے",
    "dashboard.research_assistant": "AI ریسرچ اسسٹنٹ",
    "dashboard.ocr": "تصویر سے متن (OCR)",
    "dashboard.tts": "متن سے تقریر (TTS)",
    "stt.title": "تقریر سے متن",
    "stt.start": "ریکارڈنگ شروع کریں",
    "stt.stop": "ریکارڈنگ بند کریں",
    "stt.language": "زبان",
    "stt.transcript": "ٹرانسکرپٹ",
    "stt.copy": "کاپی",
    "stt.download": "ڈاؤن لوڈ",
    "stt.no_transcript": "ٹرانسکرائب شروع کرنے کے لیے مائک بٹن دبائیں...",
    "stt.recording": "ریکارڈنگ...",
    "stt.processing": "پروسیسنگ...",
    "stt.limit_reached": "مفت حد تک پہنچ گئی۔ لامحدود رسائی کے لیے پرو میں اپ گریڈ کریں۔",
    "settings.title": "ترتیبات",
    "settings.profile": "پروفائل",
    "settings.display_name": "نمائشی نام",
    "settings.language": "ترجیحی زبان",
    "settings.subscription": "سبسکرپشن",
    "settings.current_plan": "موجودہ منصوبہ",
    "settings.free": "مفت",
    "settings.pro": "پرو",
    "settings.save": "تبدیلیاں محفوظ کریں",
    "settings.logout": "لاگ آؤٹ",
    "auth.login": "لاگ ان",
    "auth.signup": "سائن اپ",
    "auth.email": "ای میل",
    "auth.password": "پاس ورڈ",
    "auth.forgot_password": "پاس ورڈ بھول گئے؟",
    "auth.no_account": "اکاؤنٹ نہیں ہے؟",
    "auth.have_account": "پہلے سے اکاؤنٹ ہے؟",
    "auth.google": "گوگل سے جاری رکھیں",
    "auth.reset_password": "پاس ورڈ ری سیٹ",
    "auth.new_password": "نیا پاس ورڈ",
    "auth.send_reset": "ری سیٹ لنک بھیجیں",
    "auth.back_to_login": "لاگ ان پر واپس جائیں",
  },
};

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  direction: "ltr",
  setLanguage: () => {},
  t: (key: string) => key,
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>("en");

  const direction: Direction = language === "ur" ? "rtl" : "ltr";

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("easyeditor-lang", lang);
  };

  const t = (key: string): string => {
    return translations[language][key] || key;
  };

  useEffect(() => {
    const saved = localStorage.getItem("easyeditor-lang") as Language | null;
    if (saved && (saved === "en" || saved === "ur")) {
      setLanguageState(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = language === "ur" ? "ur" : "en";
  }, [direction, language]);

  return (
    <LanguageContext.Provider value={{ language, direction, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
