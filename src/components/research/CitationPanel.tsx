/**
 * CitationPanel — Collapsible session citations panel (Islamic mode, Pro+)
 *
 * Displays all sources fetched during the current session as CitationBadges
 * with clickable links. Shown/hidden via toggle button in ChatDisplay header.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookMarked, Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import CitationBadge, { formatCitation } from "./CitationBadge";
import { CitationFeedbackBar } from "./CitationFeedbackBar";
import { passageClipboardText } from "@/lib/citations/passageText";
import { highlightSegments } from "@/lib/citations/highlight";
import { DOMAIN_LABEL, groupByDomain } from "@/lib/citations/domains";

// The type moved to shared/ (M9 defect #3) so the Electron agent can import it
// without crossing the purity boundary. Re-exported here for the existing
// call sites that import it from this module.
export type { CitationItem, ScholarlyCitationRef } from "~shared/research/citationTypes";
import type { CitationItem } from "~shared/research/citationTypes";

interface CitationPanelProps {
  citations: CitationItem[];
  /** The user's question. When it is Arabic, its words are marked in each passage. */
  query?: string;
  t: import("@/lib/i18n").Translator;
}

/** A passage with the user's search words marked (plain text when there is nothing to mark). */
const Marked = ({ text, query }: { text: string; query?: string }) => (
  <>
    {highlightSegments(text, query).map((seg, i) =>
      seg.match ? (
        <mark key={i} className="rounded-sm bg-warning-soft px-0.5 text-inherit dark:bg-warning/50">
          {seg.text}
        </mark>
      ) : (
        <span key={i}>{seg.text}</span>
      ),
    )}
  </>
);

const PassageCard = ({ index, item, query, t }: { index: number; item: CitationItem; query?: string; t: CitationPanelProps["t"] }) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const arabic = item.content_ar?.trim() ?? "";
  const translation = item.content?.trim() ?? "";
  // Corpus rows often carry the Urdu translation in `content` and the Arabic matn
  // separately; the matn leads, the translation sits under it.
  const showTranslation = translation !== "" && translation !== arabic;
  const text = arabic || translation;
  const long = (arabic.length + (showTranslation ? translation.length : 0)) > 280;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(passageClipboardText(item));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can be blocked (permissions, insecure context): stay silent, the text is selectable */
    }
  };

  return (
    <li className="rounded-md border border-border bg-background p-2 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-muted-foreground tabular-nums">[{index}]</span>
          {/* A reference can be a whole sentence (agent results carry the formatted line):
              let the chip wrap inside the card instead of stretching it. */}
          <div className="min-w-0 max-w-full [&>*]:!whitespace-normal [&>*]:!rounded-lg [&>*]:!leading-snug">
            <CitationBadge domain={item.domain} citationRef={{ ...item.citation_ref, url: item.url ?? item.citation_ref.url }} />
          </div>
        </div>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("research.copy", "کاپی")}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? t("research.copied_short", "کاپی ہو گیا") : t("research.copy", "کاپی")}
        </button>
      </div>
      {text && (
        <>
          {arabic && (
            <p
              dir="rtl"
              lang="ar"
              className={`font-[Amiri,'Noto_Naskh_Arabic',serif] text-xl leading-[2.2] text-foreground whitespace-pre-wrap break-words ${expanded || !long ? "" : "line-clamp-4"}`}
            >
              <Marked text={arabic} query={query} />
            </p>
          )}
          {(showTranslation || !arabic) && (
            <p
              dir="auto"
              className={`${arabic ? "text-sm text-muted-foreground" : "text-sm text-foreground"} leading-7 whitespace-pre-wrap break-words ${expanded || !long ? "" : "line-clamp-4"}`}
            >
              <Marked text={translation} query={query} />
            </p>
          )}
          {item.citation_ref.also_in && item.citation_ref.also_in.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("research.also_in", "یہی حدیث یہاں بھی:")} {item.citation_ref.also_in.join("، ")}
            </p>
          )}
          {long && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs text-primary hover:underline">
              {expanded ? t("research.show_less", "کم دکھائیں") : t("research.show_more", "مکمل عبارت")}
            </button>
          )}
        </>
      )}
      <CitationFeedbackBar
        citation={{
          reference: formatCitation(item.domain, item.citation_ref),
          grade: item.citation_ref.grade,
          gradedBy: item.citation_ref.mohdith,
          sourceUrl: item.url ?? item.citation_ref.url,
        }}
      />
    </li>
  );
};

const CitationPanel = ({ citations, query, t }: CitationPanelProps) => {
  // Open by default when the passages themselves are available — the text is
  // the evidence, so it should be what the reader sees first, not a closed box.
  const hasPassages = citations.some((c) => !!(c.content?.trim() || c.content_ar?.trim()));
  const [isOpen, setIsOpen] = useState(hasPassages);
  const [showMore, setShowMore] = useState(false);

  if (citations.length === 0) return null;

  // Results beyond the ones the model read are browse-only: counted apart, folded away.
  const main = citations.filter((c) => !c.extra);
  const extra = citations.filter((c) => c.extra);
  const groups = groupByDomain(main);
  const domainCount = Object.keys(groups).length;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <BookMarked className="h-4 w-4 text-primary shrink-0" />
          <span>{t("research.citations_panel_title")}</span>
          <span className="ms-1 rounded-full bg-primary/10 text-primary text-xs font-semibold px-1.5 py-0.5 leading-none">
            {main.length}
          </span>
          <span className="text-xs text-muted-foreground font-normal">
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
            {/* Radix wraps the content in a `display: table` box, which grows to the widest
                child (a long reference) and pushes the whole panel past its column. */}
            <ScrollArea className={`${hasPassages ? "max-h-[32rem]" : "max-h-64"} [&_[data-radix-scroll-area-viewport]>div]:!block`}>
              {hasPassages ? (
                // Numbered in retrieval order so [N] matches the inline
                // citations in the answer.
                <ol className="px-3 pb-3 pt-2 space-y-2">
                  {main.map((item, i) => (
                    <PassageCard key={`${item.domain}-${i}`} index={i + 1} item={item} query={query} t={t} />
                  ))}
                  {extra.length > 0 && !showMore && (
                    <li className="list-none">
                      <button
                        type="button"
                        onClick={() => setShowMore(true)}
                        className="w-full rounded-md border border-dashed border-border py-2 text-sm text-primary hover:bg-muted"
                      >
                        {t("research.more_results", "مزید {n} نتائج دکھائیں").replace("{n}", String(extra.length))}
                      </button>
                    </li>
                  )}
                  {showMore && extra.map((item, i) => (
                    <PassageCard key={`x-${item.domain}-${i}`} index={main.length + i + 1} item={item} query={query} t={t} />
                  ))}
                </ol>
              ) : (
                <div className="px-3 pb-3 space-y-3">
                  {Object.entries(groups).map(([domain, items]) => (
                    <div key={domain} className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
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
              )}
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CitationPanel;
