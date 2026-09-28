/**
 * M13 Phase 3 (ADR-0058) — the classical Arabic reference for a Shamela page,
 * built DETERMINISTICALLY from catalogue + page-table data. The model never
 * composes a footnote; it only picks which retrieved page to cite, and
 * `insert_footnote` writes this string (via the retrieval ledger's reference).
 *
 *   المؤلف (ت ٢٥٦هـ)، الكتاب، ج ١، ص ٦
 *
 * Western digits are kept (as every other reference in the app uses them);
 * the death year is Hijri. Pure — no runtime globals.
 */
export interface ShamelaRefParts {
  title: string;
  author?: string | null;
  /** Hijri death year; Shamela uses 99999 for "unknown". */
  deathYear?: number | null;
  /** Shamela's `page.part` — a volume label, often "1", sometimes "المقدمة". */
  volume?: string | null;
  /** Whether the book has more than one volume (a single-volume book omits ج). */
  multiVolume?: boolean;
  /** The printed page (`page.page`), when the edition records one. */
  printedPage?: number | null;
  /** Shamela's internal page id — the fallback when there is no printed page. */
  internalPage?: number | null;
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** `ت 256هـ` — or '' when unknown. */
export function deathLabel(deathYear: number | null | undefined): string {
  if (!deathYear || !Number.isFinite(deathYear) || deathYear <= 0 || deathYear >= 99999) return '';
  return `ت ${deathYear}هـ`;
}

/** `ج 1، ص 6` / `ص 6` / `ص 6 (ترقيم الشاملة)`. */
export function volumePageLabel(p: Pick<ShamelaRefParts, 'volume' | 'multiVolume' | 'printedPage' | 'internalPage'>): string {
  const parts: string[] = [];
  const vol = clean(p.volume);
  if (vol && p.multiVolume) parts.push(/^\d+$/.test(vol) ? `ج ${vol}` : vol);
  if (p.printedPage && p.printedPage > 0) parts.push(`ص ${p.printedPage}`);
  else if (p.internalPage && p.internalPage > 0) parts.push(`ص ${p.internalPage} (ترقيم الشاملة)`);
  return parts.join('، ');
}

/** The full reference: author (death), title, volume, page. */
export function formatShamelaReference(p: ShamelaRefParts): string {
  const title = clean(p.title) || 'الشاملة';
  const author = clean(p.author);
  const death = deathLabel(p.deathYear);
  const head = author ? (death ? `${author} (${death})` : author) : '';
  return [head, title, volumePageLabel(p)].filter(Boolean).join('، ');
}
