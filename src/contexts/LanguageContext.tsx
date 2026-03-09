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
    "nav.speak": "Speak",
    "tts.title": "Text to Speech",
    "tts.subtitle": "Convert text to natural speech with diverse personas",
    "tts.select_persona": "Select a Voice Persona",
    "tts.enter_text": "Enter Text",
    "tts.placeholder": "Type or paste text here to convert to speech...",
    "tts.speed": "Playback Speed",
    "tts.listen": "Listen",
    "tts.stop": "Stop",
    "tts.download": "Download",
    "tts.playing": "Playing...",
    "tts.generating": "Generating...",
    "tts.chars_used": "Characters Used",
    "tts.limit_warning": "You are approaching your free tier limit!",
    "tts.limit_reached": "Free tier character limit reached. Upgrade to Pro.",
    "tts.text_too_long": "Text exceeds character limit.",
    "tts.downloaded": "Audio downloaded!",
    "tts.download_error": "Download not supported in this browser.",
    "tts.error": "Speech synthesis error.",
    "nav.ocr": "OCR",
    "ocr.title": "Image to Text (OCR)",
    "ocr.subtitle": "Extract text from images in Urdu, Arabic, and English",
    "ocr.upload_hint": "Upload an image or take a photo to extract text",
    "ocr.upload": "Upload",
    "ocr.camera": "Camera",
    "ocr.extract": "Extract Text",
    "ocr.processing": "Processing...",
    "ocr.result": "Extracted Text",
    "ocr.copy": "Copy",
    "ocr.listen_now": "Listen Now",
    "ocr.copied": "Text copied to clipboard!",
    "ocr.copy_failed": "Failed to copy text.",
    "ocr.success": "Text extracted successfully!",
    "ocr.no_text_found": "No text found in the image.",
    "ocr.error": "Failed to process image.",
    "ocr.limit_reached": "Usage limit reached. Upgrade to Pro.",
    "ocr.invalid_file": "Please select a valid image file.",
    "ocr.file_too_large": "Image must be under 10MB.",
    "ocr.auto_copy": "Auto-copy",
    "ocr.auto_copied": "Text auto-copied to clipboard!",
    "ocr.drop_here": "Drop image here",
    "ocr.zoom": "Zoom",
    "ocr.rotate": "Rotate",
    "ocr.cancel": "Cancel",
    "ocr.apply_crop": "Apply",
    "tts.fallback_browser": "Using standard voice as premium is currently unavailable.",
    "tts.cost": "Cost",
    "tts.chars": "chars",
    "dashboard.recent_activity": "Recent Activity",
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
    "nav.speak": "بولیں",
    "tts.title": "متن سے تقریر",
    "tts.subtitle": "متنوع آوازوں کے ساتھ متن کو قدرتی تقریر میں تبدیل کریں",
    "tts.select_persona": "آواز کا کردار منتخب کریں",
    "tts.enter_text": "متن درج کریں",
    "tts.placeholder": "تقریر میں تبدیل کرنے کے لیے یہاں متن ٹائپ کریں یا پیسٹ کریں...",
    "tts.speed": "پلے بیک کی رفتار",
    "tts.listen": "سنیں",
    "tts.stop": "رکیں",
    "tts.download": "ڈاؤن لوڈ",
    "tts.playing": "چل رہا ہے...",
    "tts.generating": "بنایا جا رہا ہے...",
    "tts.chars_used": "حروف استعمال ہوئے",
    "tts.limit_warning": "آپ اپنی مفت حد کے قریب پہنچ رہے ہیں!",
    "tts.limit_reached": "مفت حد تک پہنچ گئی۔ پرو میں اپ گریڈ کریں۔",
    "tts.text_too_long": "متن حد سے زیادہ ہے۔",
    "tts.downloaded": "آڈیو ڈاؤن لوڈ ہو گیا!",
    "tts.download_error": "اس براؤزر میں ڈاؤن لوڈ دستیاب نہیں۔",
    "tts.error": "تقریر میں خرابی۔",
    "nav.ocr": "OCR",
    "ocr.title": "تصویر سے متن (OCR)",
    "ocr.subtitle": "اردو، عربی اور انگریزی میں تصاویر سے متن نکالیں",
    "ocr.upload_hint": "متن نکالنے کے لیے تصویر اپ لوڈ کریں یا فوٹو لیں",
    "ocr.upload": "اپ لوڈ",
    "ocr.camera": "کیمرہ",
    "ocr.extract": "متن نکالیں",
    "ocr.processing": "پروسیسنگ...",
    "ocr.result": "نکالا ہوا متن",
    "ocr.copy": "کاپی",
    "ocr.listen_now": "ابھی سنیں",
    "ocr.copied": "متن کلپ بورڈ پر کاپی ہو گیا!",
    "ocr.copy_failed": "متن کاپی کرنے میں ناکامی۔",
    "ocr.success": "متن کامیابی سے نکالا گیا!",
    "ocr.no_text_found": "تصویر میں کوئی متن نہیں ملا۔",
    "ocr.error": "تصویر پروسیس کرنے میں ناکامی۔",
    "ocr.limit_reached": "استعمال کی حد پوری ہو گئی۔ پرو میں اپ گریڈ کریں۔",
    "ocr.invalid_file": "براہ کرم ایک درست تصویر منتخب کریں۔",
    "ocr.file_too_large": "تصویر 10MB سے کم ہونی چاہیے۔",
    "ocr.auto_copy": "خودکار کاپی",
    "ocr.auto_copied": "متن خودکار طور پر کاپی ہو گیا!",
    "ocr.drop_here": "تصویر یہاں چھوڑیں",
    "ocr.zoom": "زوم",
    "ocr.rotate": "گھمائیں",
    "ocr.cancel": "منسوخ",
    "ocr.apply_crop": "لاگو کریں",
    "tts.fallback_browser": "پریمیم دستیاب نہیں، معیاری آواز استعمال ہو رہی ہے۔",
    "tts.cost": "لاگت",
    "tts.chars": "حروف",
    "dashboard.recent_activity": "حالیہ سرگرمی",
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
