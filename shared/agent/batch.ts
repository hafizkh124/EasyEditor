/**
 * Plan §4.6 — batch mode: run one agent turn per book (or per author) over a
 * multi-book `#` scope, then fold the results into one artifact.
 *
 * Pure — no runtime globals. The loop itself is `electron/agent/batch.ts`.
 */

/** Above this the review dialog disables batch; the agent path returns
 *  `needs-input` asking the scholar to narrow (plan §4.6 / approved Q3). */
export const BATCH_MAX_ITEMS = 25;

export type BatchGranularity = "per-book" | "per-author";
export type AggregateShape = "document" | "table";

export interface BatchItem {
  /** Stable key for progress + resume. */
  key: string;
  /** Human label for the progress row / artifact section ("فتح الباري"). */
  label: string;
  /** The book refs this item's sub-run is scoped to. */
  bookRefs: string[];
}

export interface BatchScope {
  /** Every concrete book ref in the scope (deduped). */
  books: string[];
  /** The `#` groups, each with its own book list + a label. */
  groups: Array<{ type: string; ref: string; label: string; bookRefs: string[] }>;
  granularity: BatchGranularity;
}

/**
 * Split a scope into batch items. `per-book` → one item per distinct book ref;
 * `per-author` → one item per group (which, for an author scope, is that
 * author's books; for category/century each group is still one item — the
 * caller should prefer `per-book` there).
 */
export function planBatchItems(scope: BatchScope): BatchItem[] {
  if (scope.granularity === "per-author" && scope.groups.length > 0) {
    return scope.groups.map((g) => ({
      key: g.ref,
      label: g.label,
      bookRefs: g.bookRefs.length ? g.bookRefs : scope.books,
    }));
  }
  // per-book — one item per distinct ref, in stable order.
  const seen = new Set<string>();
  const items: BatchItem[] = [];
  for (const ref of scope.books) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    items.push({ key: ref, label: ref, bookRefs: [ref] });
  }
  return items;
}

// Note: JS `\b` word boundaries don't fire next to Arabic-script letters, so the
// Latin hints keep `\b` and the Urdu/Arabic ones match as plain substrings.
const TABLE_HINT =
  /\b(list|table|comparison|compare across|per book|column|columns)\b|(جدول|فہرست|ہر کتاب سے|صفحہ نمبر|کالم|موازنہ)/i;

/** Guess whether the aggregated output is a document (one section per item) or
 *  a merged table. */
export function inferAggregateShape(userTask: string): AggregateShape {
  return TABLE_HINT.test(userTask) ? "table" : "document";
}

/** The per-item instruction — the scholar's task, scoped to this one book/author. */
export function buildPerItemInstruction(userTask: string, item: BatchItem): string {
  return (
    `${userTask.trim()}\n\n` +
    `[بیچ] یہ ذیلی کام صرف اس ماخذ پر کریں: «${item.label}». ` +
    `صرف اسی کتاب/مصنف سے جواب دیں؛ اگر اس میں کچھ نہ ملے تو صاف کہیں "اس ماخذ میں نہیں ملا".`
  );
}
