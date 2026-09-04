/**
 * M9 Phase 6 — turn Word's Compare revisions into an apparatus criticus.
 *
 * Word's `Compare` reports each difference as an `insert` or `delete` revision.
 * A substitution shows up as a `delete` (base wording) immediately followed by
 * an `insert` (witness wording) at the same place. This pairs those into loci
 * and labels the kind of variant, so a critical-edition editor sees
 * "موضع | متن الأصل | نسخة <siglum> | نوع الاختلاف" rather than a raw diff.
 *
 * Pure — no runtime globals.
 */

export interface Revision {
  type: 'insert' | 'delete' | 'other';
  text: string;
  context: string;
  page: number;
}

export type VariantKind = 'substitution' | 'addition' | 'omission' | 'other';

export interface Locus {
  /** 1-based, in reading order. */
  index: number;
  page: number;
  /** The reading in the base manuscript (empty for a pure addition in the witness). */
  base: string;
  /** The reading in the witness (empty for an omission — present in base, absent in witness). */
  witness: string;
  kind: VariantKind;
  /** A short window of surrounding text, for placing the variant. */
  context: string;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Pair adjacent delete/insert revisions into loci. `base` is the older
 * manuscript, `witness` the one compared against it.
 */
export function buildApparatus(revisions: Revision[]): Locus[] {
  const loci: Locus[] = [];
  let i = 0;
  while (i < revisions.length) {
    const r = revisions[i];
    const next = revisions[i + 1];

    // Word's Compare emits a substitution as the deletion (old wording) FOLLOWED
    // by the insertion (new wording) at the same place — always delete-first. An
    // insert-then-delete is two variants at different points, not one.
    if (r.type === 'delete' && next?.type === 'insert') {
      loci.push({ index: 0, page: r.page || next.page, base: clean(r.text), witness: clean(next.text), kind: 'substitution', context: clean(next.context || r.context) });
      i += 2;
      continue;
    }
    if (r.type === 'insert') {
      loci.push({ index: 0, page: r.page, base: '', witness: clean(r.text), kind: 'addition', context: clean(r.context) });
    } else if (r.type === 'delete') {
      loci.push({ index: 0, page: r.page, base: clean(r.text), witness: '', kind: 'omission', context: clean(r.context) });
    } else {
      loci.push({ index: 0, page: r.page, base: clean(r.text), witness: '', kind: 'other', context: clean(r.context) });
    }
    i += 1;
  }
  loci.forEach((l, n) => { l.index = n + 1; });
  return loci;
}

const KIND_AR: Record<VariantKind, string> = {
  substitution: 'استبدال',
  addition: 'زيادة في النسخة',
  omission: 'سقط من النسخة',
  other: 'اختلاف',
};

/** The apparatus as artifact-table rows. `siglum` labels the witness column (e.g. "ب"). */
export function apparatusTable(loci: Locus[], siglum: string): { columns: string[]; rows: string[][] } {
  return {
    columns: ['#', 'الصفحة', 'متن الأصل', `نسخة ${siglum || 'ب'}`, 'نوع الاختلاف', 'الموضع'],
    rows: loci.map((l) => [
      String(l.index),
      l.page ? String(l.page) : '—',
      l.base || '—',
      l.witness || '—',
      KIND_AR[l.kind],
      l.context.slice(0, 80),
    ]),
  };
}
