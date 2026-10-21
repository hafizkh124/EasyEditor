import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { classifyHadithGrade, GRADE_FAMILY_STYLE } from "@/lib/citations/hadithGrade";
import { domainLabel } from "@/lib/citations/domains";
import { useLanguage } from "@/contexts/LanguageContext";

interface CitationRef {
  // Hadith fields
  book?: string;
  collection?: string;
  hadith_number?: string | number;
  grade?: string;
  rawi?: string;
  // Quran fields
  surah_number?: number;
  surah_name?: string;
  surah_name_en?: string;
  verse?: number;
  juz?: number;
  // Fatwa fields
  site?: string;
  fatwa_number?: string;
  scholar?: string;
  // Classical fields
  author?: string;
  title?: string;
  volume?: number;
  page?: number;
  // Common
  url?: string;
  type?: string;
}

interface CitationBadgeProps {
  domain: string;
  citationRef: CitationRef;
  className?: string;
}

export function formatCitation(domain: string, ref: CitationRef): string {
  // Hadith
  if (domain === "dorar" || domain === "sunnah" || domain === "hadith-index" ||
      ref.hadith_number !== undefined) {
    const parts: string[] = [];
    if (ref.book) parts.push(ref.book);
    if (ref.hadith_number !== undefined) parts.push(`No. ${ref.hadith_number}`);
    // Grade renders as its own chip (below), not folded into this label —
    // STRATEGY-v1 P2 wants it visually distinct, not buried in a joined string.
    if (ref.rawi) parts.push(`Narrated: ${ref.rawi}`);
    return parts.join(" · ") || "Hadith";
  }

  // Quran
  if (domain === "alquran" || domain === "quran-com" || domain === "tanzil" ||
      ref.surah_number !== undefined) {
    const parts: string[] = [];
    if (ref.surah_name_en || ref.surah_name) parts.push(ref.surah_name_en ?? ref.surah_name ?? "");
    if (ref.surah_number && ref.verse) parts.push(`${ref.surah_number}:${ref.verse}`);
    if (ref.juz) parts.push(`Juz ${ref.juz}`);
    return parts.join(" · ") || "Quran";
  }

  // Fatwa
  if (domain === "islamqa" || domain === "islamweb" || domain === "dar-alifta" ||
      ref.fatwa_number !== undefined) {
    const parts: string[] = [];
    if (ref.site) parts.push(ref.site);
    else if (domain) parts.push(domain);
    if (ref.fatwa_number) parts.push(`Fatwa #${ref.fatwa_number}`);
    if (ref.scholar) parts.push(ref.scholar);
    return parts.join(" · ") || "Fatwa";
  }

  // Classical
  if (ref.author || ref.title || ref.volume) {
    const parts: string[] = [];
    if (ref.author) parts.push(ref.author);
    if (ref.title) parts.push(ref.title);
    if (ref.volume) parts.push(`Vol. ${ref.volume}`);
    if (ref.page) parts.push(`P. ${ref.page}`);
    return parts.join(" · ") || "Source";
  }

  return domain || "Source";
}

function domainColor(domain: string): string {
  if (domain === "dorar" || domain === "sunnah" || domain === "hadith-index") {
    return "bg-success-soft border-success-border text-success";
  }
  if (domain === "alquran" || domain === "quran-com" || domain === "tanzil") {
    return "bg-info-soft border-info-border text-info";
  }
  if (domain === "islamqa" || domain === "islamweb" || domain === "dar-alifta") {
    return "bg-warning-soft border-warning-border text-warning";
  }
  return "bg-muted border-border text-muted-foreground";
}

const CitationBadge = ({ domain, citationRef, className }: CitationBadgeProps) => {
  const { t } = useLanguage();
  const label = formatCitation(domain, citationRef);
  const colorClass = domainColor(domain);

  const inner = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap",
        colorClass,
        citationRef.url && "cursor-pointer hover:opacity-80 transition-opacity",
        className
      )}
    >
      {/* An isolated LTR run ("Al-Baqarah · 2:173 · Juz 2") sitting in RTL
          chrome: <bdi> keeps it from reordering against its surroundings. */}
      <bdi>{label}</bdi>
      {citationRef.url && <ExternalLink className="h-2.5 w-2.5 shrink-0" />}
    </span>
  );

  const badge = citationRef.url ? (
    <a href={citationRef.url} target="_blank" rel="noopener noreferrer" className="no-underline">
      {inner}
    </a>
  ) : (
    inner
  );

  if (!citationRef.grade) return badge;

  // STRATEGY-v1 P2 — a quiet grading chip, Dorar-style: never a banner, and
  // never presented as our own verdict. Unclassifiable text still shows the
  // source's exact wording, just without a colour claim we can't back up
  // (STRATEGY-v1 risk #1 — overclaiming grading precision).
  const family = classifyHadithGrade(citationRef.grade);
  const style = family ? GRADE_FAMILY_STYLE[family] : null;
  const source = domainLabel(domain);
  const disclaimer = t("citations.grade_disclaimer", "{source}: {grade} — graded by the source, not by us")
    .replace("{source}", source)
    .replace("{grade}", citationRef.grade);

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {badge}
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap",
          style ? style.chip : "bg-muted border-border text-muted-foreground",
        )}
        title={disclaimer}
      >
        {style ? style.label : citationRef.grade}
      </span>
    </span>
  );
};

export default CitationBadge;
