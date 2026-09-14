import { BookOpen, Search, MessageCircle, Sparkles, FileSearch, Quote, BookMarked } from "lucide-react";
import { motion } from "framer-motion";

interface EmptyStateProps {
  onSuggestionClick: (text: string) => void;
  t: import("@/lib/i18n").Translator;
  /** True once there's an open project folder/document for the agent to
   * read from (`useAgentRun`'s `hasWriteTarget`) — it can then summarize
   * chapters and verify citations, so it gets its own suggestion set.
   * With nothing open yet (Ask mode runs that way too, M11) the plain
   * research suggestions apply instead — the agent ones would point at a
   * project that isn't there. */
  isAgentMode?: boolean;
}

/**
 * SPEC M10 §1.1 — the اسلامی/عمومی mode is gone, so there is only ever one
 * plain-research suggestion set now (islamic-search's own auto-strictness
 * handles a genuinely general question — see useResearchChat's runQuery).
 * The old "general" suggestions/welcome copy are dead: nothing calls this
 * with a different mode anymore.
 */
const RESEARCH_SUGGESTIONS = [
  { icon: BookOpen, labelKey: "research.suggestion_islamic_1", queryKey: "research.suggestion_islamic_1_query" },
  { icon: Search, labelKey: "research.suggestion_islamic_2", queryKey: "research.suggestion_islamic_2_query" },
  { icon: MessageCircle, labelKey: "research.suggestion_islamic_3", queryKey: "research.suggestion_islamic_3_query" },
] as const;

const AGENT_SUGGESTIONS = [
  { icon: BookMarked, labelKey: "research.suggestion_agent_1", queryKey: "research.suggestion_agent_1_query" },
  { icon: Quote, labelKey: "research.suggestion_agent_2", queryKey: "research.suggestion_agent_2_query" },
  { icon: FileSearch, labelKey: "research.suggestion_agent_3", queryKey: "research.suggestion_agent_3_query" },
] as const;

const EmptyState = ({ onSuggestionClick, t, isAgentMode = false }: EmptyStateProps) => {
  const SUGGESTIONS = isAgentMode ? AGENT_SUGGESTIONS : RESEARCH_SUGGESTIONS;
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
        {isAgentMode ? t("research.welcome_agent") : t("research.welcome_islamic")}
      </motion.h3>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="text-sm text-muted-foreground max-w-md mb-8"
      >
        {isAgentMode ? t("research.welcome_agent_hint") : t("research.welcome_islamic_hint")}
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.3 }}
        className="grid gap-2 w-full max-w-md sm:grid-cols-1"
      >
        {SUGGESTIONS.map((s, i) => {
          const label = t(s.labelKey as import("@/lib/i18n").TranslationKey);
          const query = t(s.queryKey as import("@/lib/i18n").TranslationKey) || label;
          if (!label) return null;
          return (
            <button
              key={i}
              onClick={() => onSuggestionClick(query)}
              className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-start text-sm text-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm active:scale-[0.98]"
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
