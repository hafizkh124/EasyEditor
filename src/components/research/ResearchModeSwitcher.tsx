import { BookOpen, FileText, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export type ResearchMode = "islamic" | "custom" | "general";

interface ResearchModeSwitcherProps {
  mode: ResearchMode;
  onModeChange: (m: ResearchMode) => void;
  t: import("@/lib/i18n").Translator;
}

const TABS: Array<{ value: ResearchMode; icon: typeof BookOpen; labelKey: string }> = [
  { value: "islamic", icon: BookOpen, labelKey: "research.tab_islamic" },
  { value: "custom", icon: FileText, labelKey: "research.tab_custom" },
  { value: "general", icon: Globe, labelKey: "research.tab_general" },
];

const ResearchModeSwitcher = ({ mode, onModeChange, t }: ResearchModeSwitcherProps) => {
  return (
    <div
      role="tablist"
      aria-label={t("research.mode_label")}
      className="flex items-center gap-1 rounded-lg border border-border bg-muted p-1"
    >
      {TABS.map(({ value, icon: Icon, labelKey }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            role="tab"
            aria-selected={active}
            onClick={() => onModeChange(value)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/60",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="whitespace-nowrap">{t(labelKey as import("@/lib/i18n").TranslationKey)}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ResearchModeSwitcher;
