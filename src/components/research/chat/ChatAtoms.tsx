import { motion } from "framer-motion";
import { CheckCircle2, User, Bot } from "lucide-react";
import type { Translator } from "@/lib/i18n";

/**
 * M11 Phase 5 — brand logo animation (teal spinner → pulse → green check).
 * Respects prefers-reduced-motion. Replaces the plain `TypingDots` this file
 * used to also export — defined in M11 but never actually wired into
 * ChatDisplay.tsx until M12 Phase H; the old export is gone now that nothing
 * uses it.
 */
export const BrandSpinner: React.FC<{ state?: "loading" | "thinking" | "done" }> = ({ state = "loading" }) => {
  // Respect prefers-reduced-motion: show static dots instead of animation
  const prefersReduced = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReduced) {
    return (
      <span className="inline-flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 rounded-full bg-primary opacity-60" />
        ))}
      </span>
    );
  }

  if (state === "done") {
    return (
      <motion.span
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="inline-flex items-center"
      >
        <CheckCircle2 className="h-4 w-4 text-success" />
      </motion.span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: "#0d9488" }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </span>
  );
};

/** Long source ids shortened for the "sources ready" strip. */
const DOMAIN_SHORT: Record<string, string> = {
  dorar: "Dorar", sunnah: "Sunnah", "hadith-index": "Hadith Index",
  alquran: "AlQuran", "quran-com": "Quran.com", tanzil: "Tanzil",
  islamqa: "IslamQA", islamweb: "IslamWeb", "dar-alifta": "Dar-Alifta",
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
      className="flex items-center gap-2 rounded-lg border border-success-border bg-success-soft px-3 py-2 text-xs text-success"
    >
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-semibold">{count}</span>{" "}
        {t("research.sources_fetched")}
        {domainLabels && (
          <span className="text-success ms-1">— {domainLabels}</span>
        )}
      </span>
    </motion.div>
  );
};

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
