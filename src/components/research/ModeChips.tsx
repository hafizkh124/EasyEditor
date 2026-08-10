import { Check, SpellCheck2, Quote } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchAssistMode } from "@/lib/prompts";

interface ModeChipsProps {
  modes: ResearchAssistMode[];
  onModesChange: (modes: ResearchAssistMode[]) => void;
  disabled?: boolean;
  t: import("@/lib/i18n").Translator;
}

const CHIPS: Array<{ value: ResearchAssistMode; icon: typeof Check; labelKey: string }> = [
  { value: "spelling", icon: SpellCheck2, labelKey: "research.chip_spelling" },
  { value: "citations", icon: Quote, labelKey: "research.chip_citations" },
];

const ModeChips = ({ modes, onModesChange, disabled = false, t }: ModeChipsProps) => {
  const toggle = (value: ResearchAssistMode) => {
    if (modes.includes(value)) {
      onModesChange(modes.filter((m) => m !== value));
    } else {
      onModesChange([...modes, value]);
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={t("research.chips_label")}>
      {CHIPS.map(({ value, icon: Icon, labelKey }) => {
        const active = modes.includes(value);
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => toggle(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30",
            )}
          >
            {active ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
            {t(labelKey as import("@/lib/i18n").TranslationKey)}
          </button>
        );
      })}
    </div>
  );
};

export default ModeChips;
