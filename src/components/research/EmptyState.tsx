import { BookOpen, Sparkles, Search, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";
import type { ResearchMode } from "./ResearchModeSwitcher";

interface EmptyStateProps {
  mode: ResearchMode;
  onSuggestionClick: (text: string) => void;
  t: import("@/lib/i18n").Translator;
}

const SUGGESTIONS: Record<ResearchMode, { icon: typeof Search; labelKey: string; queryKey: string }[]> = {
  islamic: [
    { icon: BookOpen, labelKey: "research.suggestion_islamic_1", queryKey: "research.suggestion_islamic_1_query" },
    { icon: Search, labelKey: "research.suggestion_islamic_2", queryKey: "research.suggestion_islamic_2_query" },
    { icon: MessageCircle, labelKey: "research.suggestion_islamic_3", queryKey: "research.suggestion_islamic_3_query" },
  ],
  general: [
    { icon: Search, labelKey: "research.suggestion_general_1", queryKey: "research.suggestion_general_1_query" },
    { icon: MessageCircle, labelKey: "research.suggestion_general_2", queryKey: "research.suggestion_general_2_query" },
    { icon: Sparkles, labelKey: "research.suggestion_general_3", queryKey: "research.suggestion_general_3_query" },
  ],
  custom: [
    { icon: Search, labelKey: "research.suggestion_custom_1", queryKey: "research.suggestion_custom_1_query" },
    { icon: MessageCircle, labelKey: "research.suggestion_custom_2", queryKey: "research.suggestion_custom_2_query" },
  ],
};

const EmptyState = ({ mode, onSuggestionClick, t }: EmptyStateProps) => {
  const suggestions = SUGGESTIONS[mode] ?? SUGGESTIONS.general;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="mb-6"
      >
        <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
      </motion.div>

      <motion.h3
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="text-xl font-semibold text-foreground mb-2"
      >
        {mode === "islamic" ? t("research.welcome_islamic") : t("research.welcome")}
      </motion.h3>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="text-sm text-muted-foreground max-w-md mb-8"
      >
        {mode === "islamic"
          ? t("research.welcome_islamic_hint")
          : mode === "general"
            ? t("research.welcome_general_hint")
            : t("research.welcome_hint")}
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.3 }}
        className="grid gap-2 w-full max-w-md sm:grid-cols-1"
      >
        {suggestions.map((s, i) => {
          const label = t(s.labelKey as import("@/lib/i18n").TranslationKey);
          const query = t(s.queryKey as import("@/lib/i18n").TranslationKey) || label;
          if (!label) return null;
          return (
            <button
              key={i}
              onClick={() => onSuggestionClick(query)}
              className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm active:scale-[0.98]"
            >
              <s.icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="line-clamp-1">{label}</span>
            </button>
          );
        })}
      </motion.div>
    </div>
  );
};

export default EmptyState;
