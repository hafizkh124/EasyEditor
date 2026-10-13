import type { CitationItem } from "@/components/research/CitationPanel";

const DOMAIN_LABEL: Record<string, string> = {
  dorar: "Dorar.net — Hadith",
  sunnah: "Sunnah.com — Hadith",
  "hadith-index": "Hadith Index (Pre-Indexed Corpus)",
  "islamicurdubooks-hadith": "Islamic Urdu Books — Hadith",
  "islamicurdubooks-rijal": "Islamic Urdu Books — Asma ur-Rijal",
  "islamicurdubooks-tafsir": "Islamic Urdu Books — Tafsir Ibn Kathir",
  "islamicurdubooks-wbw": "Islamic Urdu Books — Quran Word-by-Word",
  "islamicurdubooks-lexicon": "Islamic Urdu Books — Quran Lexicon",
  "islamicurdubooks-misc": "Islamic Urdu Books — Duas & Terminology",
  alquran: "AlQuran.cloud — Quran",
  "quran-com": "Quran.com — Quran",
  tanzil: "Tanzil — Canonical Quran Text",
  islamqa: "IslamQA.info — Fatawa",
  islamweb: "IslamWeb.net — Fatawa",
  "dar-alifta": "Dar-Alifta.org — Fatawa",
  "shamela-index": "Al-Maktaba Al-Shamela — Classical Texts",
  "openiti-index": "OpenITI — Classical Arabic Corpus",
};

function formatCitationRef(ref: CitationItem["citation_ref"]): string {
  const parts: string[] = [];

  if (ref.book || ref.hadith_number != null) {
    if (ref.book) parts.push(ref.book);
    if (ref.hadith_number != null) parts.push(`Hadith No. ${ref.hadith_number}`);
    if (ref.grade) parts.push(`Grade: ${ref.grade}`);
    if (ref.rawi) parts.push(`Narrated by: ${ref.rawi}`);
  } else if (ref.surah_number != null) {
    const surahStr = ref.surah_name_en
      ? `${ref.surah_name_en} (${ref.surah_name ?? ""})`
      : (ref.surah_name ?? `Surah ${ref.surah_number}`);
    parts.push(surahStr);
    if (ref.verse != null) parts.push(`${ref.surah_number}:${ref.verse}`);
    if (ref.juz) parts.push(`Juz ${ref.juz}`);
  } else if (ref.fatwa_number || ref.scholar) {
    if (ref.fatwa_number) parts.push(`Fatwa No. ${ref.fatwa_number}`);
    if (ref.scholar) parts.push(`Scholar: ${ref.scholar}`);
  } else if (ref.author || ref.title) {
    if (ref.author) parts.push(ref.author);
    if (ref.title) parts.push(ref.title);
    if (ref.volume != null) parts.push(`Vol. ${ref.volume}`);
    if (ref.page != null) parts.push(`P. ${ref.page}`);
  }

  return parts.join(", ");
}

export function buildBibliographyMarkdown(allCitations: CitationItem[]): string {
  // Browse-only extras were never read by the model nor cited; they don't belong in a bibliography.
  const citations = allCitations.filter((c) => !c.extra);
  const lines: string[] = [
    "# Islamic Research Bibliography",
    `_Generated: ${new Date().toLocaleString()}_`,
    `_Session mode: Islamic Scholarly Research_`,
    "",
  ];

  const groups: Record<string, CitationItem[]> = {};
  for (const c of citations) {
    if (!groups[c.domain]) groups[c.domain] = [];
    groups[c.domain].push(c);
  }

  for (const [domain, items] of Object.entries(groups)) {
    lines.push(`## ${DOMAIN_LABEL[domain] ?? domain}`);
    for (const c of items) {
      const citationStr = formatCitationRef(c.citation_ref);
      const urlStr = c.url ? ` — ${c.url}` : "";
      lines.push(`- ${citationStr}${urlStr}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function downloadBibliography(citations: CitationItem[]): boolean {
  if (citations.filter((c) => !c.extra).length === 0) return false;
  const content = buildBibliographyMarkdown(citations);
  const blob = new Blob([content], { type: "text/markdown; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bibliography-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
