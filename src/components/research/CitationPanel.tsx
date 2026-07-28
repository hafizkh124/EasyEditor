/**
 * CitationPanel — Collapsible session citations panel (Islamic mode, Pro+)
 *
 * Displays all sources fetched during the current session as CitationBadges
 * with clickable links. Shown/hidden via toggle button in ChatDisplay header.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookMarked, ChevronDown, ChevronUp } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import CitationBadge from "./CitationBadge";
import { DOMAIN_LABEL, groupByDomain } from "@/lib/citations/domains";

export interface CitationItem {
  domain: string;
  citation_ref: {
    book?: string;
    collection?: string;
    hadith_number?: string | number;
    grade?: string;
    rawi?: string;
    surah_number?: number;
    surah_name?: string;
    surah_name_en?: string;
    verse?: number;
    juz?: number;
    fatwa_number?: string;
    scholar?: string;
    url?: string;
    volume?: number;
    page?: number;
    author?: string;
    title?: string;
    type?: string;
  };
  url?: string;
}

interface CitationPanelProps {
  citations: CitationItem[];
  t: (k: string) => string;
}

const CitationPanel = ({ citations, t }: CitationPanelProps) => {
  const [isOpen, setIsOpen] = useState(false);

  if (citations.length === 0) return null;

  const groups = groupByDomain(citations);
  const domainCount = Object.keys(groups).length;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <BookMarked className="h-4 w-4 text-primary shrink-0" />
          <span>{t("research.citations_panel_title")}</span>
          <span className="ml-1 rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-1.5 py-0.5 leading-none">
            {citations.length}
          </span>
          <span className="text-[10px] text-muted-foreground font-normal">
            {t("research.citations_from_domains").replace("{n}", String(domainCount))}
          </span>
        </div>
        {isOpen
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        }
      </button>

      {/* Collapsible body */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ScrollArea className="max-h-64">
              <div className="px-3 pb-3 space-y-3">
                {Object.entries(groups).map(([domain, items]) => (
                  <div key={domain} className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-2">
                      {DOMAIN_LABEL[domain] ?? domain}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((item, idx) => (
                        <CitationBadge
                          key={`${domain}-${idx}`}
                          domain={domain}
                          citationRef={{ ...item.citation_ref, url: item.url ?? item.citation_ref.url }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CitationPanel;
