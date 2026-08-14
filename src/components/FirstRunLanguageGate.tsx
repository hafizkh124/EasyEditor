import React, { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { hasChosenLanguage, persistLanguage, type Language } from "@/lib/i18n";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { handleSupabaseError } from "@/lib/errors";

interface FirstRunLanguageGateProps {
  children: React.ReactNode;
}

const LANGUAGE_OPTIONS: { code: Language; label: string; native: string }[] = [
  { code: "ur", label: "Urdu", native: "اردو" },
  { code: "ar", label: "Arabic", native: "العربية" },
  { code: "en", label: "English", native: "English" },
];

/** Routes where a language gate must never appear (OAuth flows render their own chrome). */
const EXEMPT_PATHS = ["/.lovable/oauth/consent", "/reset-password", "/forgot-password"];

function urlPrefixAuthoritative(): boolean {
  if (typeof window === "undefined") return false;
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  return seg === "ur" || seg === "ar";
}

function isExemptPath(): boolean {
  if (typeof window === "undefined") return false;
  return EXEMPT_PATHS.some((p) => window.location.pathname.startsWith(p));
}

/**
 * SPEC-M5 / UX-v1 P1: a brand-new user (empty localStorage) gets a calm
 * ur/ar/en picker before the app proper, instead of a silent English default.
 * A URL locale prefix (/ur, /ar) is authoritative and skips the gate. A signed-in
 * user whose profile carries a saved preference gets that applied instead.
 */
export const FirstRunLanguageGate: React.FC<FirstRunLanguageGateProps> = ({ children }) => {
  const { language, setLanguage } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const [showChooser, setShowChooser] = useState(() => {
    if (urlPrefixAuthoritative() || isExemptPath()) return false;
    return !hasChosenLanguage();
  });

  // Signed-in user on a fresh device: honour profiles.preferred_language instead
  // of asking (UX-v1 finding 2.2 — the old code only applied it on Settings mount).
  useEffect(() => {
    if (!showChooser || !user) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("preferred_language")
        .eq("user_id", user.id)
        .single();
      if (!active) return;
      if (error) { handleSupabaseError(error, "load language"); return; }
      const preferred = data?.preferred_language;
      if (preferred === "ur" || preferred === "ar" || preferred === "en") {
        persistLanguage(preferred);
        setLanguage(preferred);
        setShowChooser(false);
      }
    })();
    return () => { active = false; };
  }, [showChooser, user, setLanguage]);

  useEffect(() => {
    if (!showChooser) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [showChooser]);

  if (!showChooser) return <>{children}</>;

  // Do not flash the chooser while auth is still resolving on a fresh device.
  if (authLoading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const choose = (lang: Language) => {
    persistLanguage(lang);
    setLanguage(lang);
    setShowChooser(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">Easy Editor</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {/* Shown before any language is active; trilingual by design. */}
            اپنی زبان منتخب کریں · اختر لغتك · Choose your language
          </p>
        </div>
        <div className="space-y-2">
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.code}
              type="button"
              onClick={() => choose(option.code)}
              className="group flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-start transition-colors hover:border-primary/60 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              dir={option.code === "en" ? "ltr" : "rtl"}
            >
              <span className="flex items-center gap-3">
                <span className="text-base font-medium text-foreground">{option.native}</span>
                <span className="text-xs text-muted-foreground">{option.label}</span>
              </span>
              {language === option.code && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </button>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          You can change this anytime from Settings.
        </p>
      </div>
    </div>
  );
};

export default FirstRunLanguageGate;
