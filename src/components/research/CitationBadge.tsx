import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

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

function formatCitation(domain: string, ref: CitationRef): string {
  // Hadith
  if (domain === "dorar" || domain === "sunnah" || domain === "hadith-index" ||
      ref.hadith_number !== undefined) {
    const parts: string[] = [];
    if (ref.book) parts.push(ref.book);
    if (ref.hadith_number !== undefined) parts.push(`No. ${ref.hadith_number}`);
    if (ref.grade) parts.push(ref.grade);
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
    return "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300";
  }
  if (domain === "alquran" || domain === "quran-com" || domain === "tanzil") {
    return "bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800/50 text-sky-800 dark:text-sky-300";
  }
  if (domain === "islamqa" || domain === "islamweb" || domain === "dar-alifta") {
    return "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300";
  }
  return "bg-muted border-border text-muted-foreground";
}

const CitationBadge = ({ domain, citationRef, className }: CitationBadgeProps) => {
  const label = formatCitation(domain, citationRef);
  const colorClass = domainColor(domain);

  const inner = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
        colorClass,
        citationRef.url && "cursor-pointer hover:opacity-80 transition-opacity",
        className
      )}
    >
      {label}
      {citationRef.url && <ExternalLink className="h-2.5 w-2.5 shrink-0" />}
    </span>
  );

  if (citationRef.url) {
    return (
      <a href={citationRef.url} target="_blank" rel="noopener noreferrer" className="no-underline">
        {inner}
      </a>
    );
  }

  return inner;
};

export default CitationBadge;
