import React, { useState } from "react";
import { Sparkles, CheckCircle2, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { isFirstRunHintDismissed, dismissFirstRunHint } from "@/lib/firstRunHint";

interface FirstRunHintProps {
  /** Hide when the app has been used (library not empty) — "dismissed on use". */
  hidden: boolean;
}

const STEPS = [
  { icon: CheckCircle2, key: "home.firstrun.step1" },
  { icon: CheckCircle2, key: "home.firstrun.step2" },
] as const;

export const FirstRunHint: React.FC<FirstRunHintProps> = ({ hidden }) => {
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState(isFirstRunHintDismissed);

  if (hidden || dismissed) return null;

  const dismiss = () => {
    dismissFirstRunHint();
    setDismissed(true);
  };

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-start" role="note">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-primary text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5" />
          <span>{t("home.firstrun.title", "Welcome to Easy Editor")}</span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground/60 hover:text-foreground transition-colors"
          aria-label={t("home.firstrun.dismiss", "Dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ol className="mt-2 space-y-1">
        {STEPS.map(({ icon: Icon, key }, i) => (
          <li key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="h-3 w-3 shrink-0 text-primary/60" />
            <span>
              {i + 1}. {t(key)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default FirstRunHint;