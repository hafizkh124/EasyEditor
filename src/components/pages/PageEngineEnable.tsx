import { useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, LogIn, ScanText } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { SignInDialog } from "@/components/auth/DesktopAccountMenu";
import { isDesktop } from "@/utils/environment";
import { cn } from "@/lib/utils";

/**
 * How to switch on reading and translating pages (SYSTEM-2026 §10). On the
 * desktop the feature is never missing: without a key or an account it shows
 * the two ways to enable it — the user's own Gemini key (free of tokens, no
 * account) or signing in. On the web, signing in.
 */
export function PageEngineEnable({ what, className }: { what: "pages" | "translate"; className?: string }) {
  const { t } = useLanguage();
  const [signInOpen, setSignInOpen] = useState(false);
  const desktop = isDesktop();
  return (
    <div className={cn("space-y-4 rounded-2xl border border-border bg-card p-6 text-center", className)}>
      <ScanText className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          {what === "translate"
            ? t("pages.enable_translate_title", "ترجمہ فعال کریں")
            : t("pages.enable_pages_title", "تصویر اور PDF سے متن فعال کریں")}
        </h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          {desktop
            ? t("pages.enable_desktop_hint", "اپنی Gemini کلید لگائیں — مفت، سائن ان کے بغیر، اور کام اسی کمپیوٹر پر محفوظ رہے گا۔ یا سائن ان کر کے اپنے ٹوکن استعمال کریں۔")
            : t("pages.enable_web_hint", "یہ کام آپ کے اکاؤنٹ کے ٹوکن سے چلتا ہے، اس لیے سائن ان کریں۔")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {desktop && (
          <Button asChild className="gap-2">
            <Link to="/settings?section=keys">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              {t("pages.enable_add_key", "اپنی کلید لگائیں")}
            </Link>
          </Button>
        )}
        {desktop ? (
          <Button variant="outline" className="gap-2" onClick={() => setSignInOpen(true)}>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {t("pages.enable_sign_in", "سائن ان کریں")}
          </Button>
        ) : (
          <Button asChild className="gap-2">
            <Link to="/login">
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {t("pages.enable_sign_in", "سائن ان کریں")}
            </Link>
          </Button>
        )}
      </div>
      {desktop && <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />}
    </div>
  );
}
