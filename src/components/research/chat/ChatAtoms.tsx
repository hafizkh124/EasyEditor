import { motion } from "framer-motion";
import { CheckCircle2, User, Bot } from "lucide-react";
import type { Translator } from "@/lib/i18n";

/** Long source ids shortened for the "sources ready" strip. */
const DOMAIN_SHORT: Record<string, string> = {
  dorar: "Dorar", sunnah: "Sunnah", "hadith-index": "Hadith Index",
  alquran: "AlQuran", "quran-com": "Quran.com", tanzil: "Tanzil",
  "shamela-index": "Shamela", "openiti-index": "OpenITI",
};

interface SourcesReadyIndicatorProps {
  count: number;
  domains: string[];
  t: Translator;
}

/**
 * Shown between the question and the answer while generation runs: proof that
 * real sources were fetched, and which ones, before any text appears.
 */
export const SourcesReadyIndicator = ({ count, domains, t }: SourcesReadyIndicatorProps) => {
  if (count === 0) return null;
  const domainLabels = domains.map((d) => DOMAIN_SHORT[d] ?? d).join(" · ");
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400"
    >
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-semibold">{count}</span>{" "}
        {t("research.sources_fetched")}
        {domainLabels && (
          <span className="text-emerald-600 dark:text-emerald-500 ms-1">— {domainLabels}</span>
        )}
      </span>
    </motion.div>
  );
};

export const TypingDots = () => (
  <span className="inline-flex items-center gap-1">
    {[0, 1, 2].map((i) => (
      <motion.span
        key={i}
        className="h-1.5 w-1.5 rounded-full bg-primary"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
      />
    ))}
  </span>
);

export const UserAvatar = () => (
  <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
    <User className="h-3.5 w-3.5 text-primary" />
  </div>
);

export const AiAvatar = () => (
  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 ring-1 ring-primary/20">
    <Bot className="h-3.5 w-3.5 text-primary" />
  </div>
);
