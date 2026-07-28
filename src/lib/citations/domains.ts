/**
 * Shared source-domain vocabulary.
 *
 * `CitationPanel` owned both of these privately; the Trust UI needs the same
 * grouping and the same labels, and two copies would drift the moment a new
 * corpus is added (SPEC-M3 FR-4.6).
 */

export const DOMAIN_LABEL: Record<string, string> = {
  dorar: "Dorar.net",
  sunnah: "Sunnah.com",
  "hadith-index": "Hadith Index",
  alquran: "AlQuran.cloud",
  "quran-com": "Quran.com",
  tanzil: "Tanzil",
  islamqa: "IslamQA.info",
  islamweb: "IslamWeb.net",
  "dar-alifta": "Dar-Alifta.org",
  "shamela-index": "Shamela Library",
  "openiti-index": "OpenITI",
};

export function domainLabel(domain: string): string {
  return DOMAIN_LABEL[domain] ?? domain;
}

/** Group anything that carries a `domain` into buckets, preserving order. */
export function groupByDomain<T extends { domain: string }>(items: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    if (!groups[item.domain]) groups[item.domain] = [];
    groups[item.domain].push(item);
  }
  return groups;
}
