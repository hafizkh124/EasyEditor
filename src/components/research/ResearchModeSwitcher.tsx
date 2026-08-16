import { BookOpen, Globe, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type ResearchMode = "islamic" | "general";

interface ResearchModeSwitcherProps {
  mode: ResearchMode;
  onModeChange: (m: ResearchMode) => void;
  t: import("@/lib/i18n").Translator;
}

const OPTIONS: Array<{ value: ResearchMode; icon: typeof BookOpen; labelKey: string }> = [
  { value: "islamic", icon: BookOpen, labelKey: "research.tab_islamic" },
  { value: "general", icon: Globe, labelKey: "research.tab_general" },
];

/**
 * A compact, composer-inline mode toggle — replaces the old three-tab bar
 * (Islamic / Custom Sources / General) that used to sit across the top of
 * the whole page with a dedicated side panel per tab. "Custom Sources" is
 * gone: a one-off per-session file upload was strictly weaker than the
 * Library's permanent, embedded personal corpus, which Islamic-mode search
 * now draws from automatically (see islamic-search's Tier L) — there is
 * nothing left for a separate mode to do. That leaves exactly two genuinely
 * different research behaviors (a closed, verified Islamic corpus vs. the
 * open web), which fit in one small control instead of a tab bar.
 */
const ResearchModeSwitcher = ({ mode, onModeChange, t }: ResearchModeSwitcherProps) => {
  const [open, setOpen] = useState(false);
  const active = OPTIONS.find((o) => o.value === mode) ?? OPTIONS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("research.mode_label")}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/70 transition-colors"
      >
        <active.icon className="h-3.5 w-3.5 text-primary" />
        <span className="whitespace-nowrap">{t(active.labelKey as import("@/lib/i18n").TranslationKey)}</span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label={t("research.mode_label")}
            className="absolute bottom-full mb-1 start-0 z-50 w-48 rounded-lg border border-border bg-popover p-1 shadow-md"
          >
            {OPTIONS.map(({ value, icon: Icon, labelKey }) => (
              <button
                key={value}
                role="option"
                aria-selected={mode === value}
                onClick={() => { onModeChange(value); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-start transition-colors",
                  mode === value
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>{t(labelKey as import("@/lib/i18n").TranslationKey)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ResearchModeSwitcher;
