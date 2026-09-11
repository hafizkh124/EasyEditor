/**
 * M12 Phase E — the fatwā document shell.
 *
 * A DETERMINISTIC HTML builder, not a model prompt (ADR-0048's "the model
 * never does the arithmetic" extends here to "the model never re-types the
 * arithmetic either"): bismillah + a plain letterhead, the scholar's own
 * verbatim question, an optional computed results table taken VERBATIM from
 * `calculate_zakat`/`calculate_faraid` (never re-typed by the model — see
 * {@link resolveResultTable}), the model-written ruling/evidence discussion
 * (`draft_section` mode `'fatwa'` supplies only this part), the engine's own
 * non-fatwā disclaimer, and mufti signature lines.
 *
 * Written into a chapter through the SAME HTML->docx path `draft_section`
 * already uses (`word.ts`'s tmpdir HTML->docx), then exported to PDF through
 * the existing `convert_document` / `exportAs` op — no PDF library exists in
 * this project and none is added here. Word's HTML import does not honour an
 * external `<style>` block (the caller wraps this fragment in a fixed
 * `<head>`), so every visual property here is an INLINE style, not a class.
 *
 * Pure — no runtime globals, no `Date.now()` (the caller supplies `date`).
 */

export interface FatwaResultTable {
  columns: string[];
  rows: string[][];
  caption?: string;
}

export interface FatwaTemplateInput {
  /** Letterhead heading. Defaults to a generic "دار الافتاء" line. */
  instituteName?: string;
  /** The scholar's own verbatim question (istiftāʾ) — never model-paraphrased. */
  question: string;
  /** A deterministic table from calculate_zakat/calculate_faraid — inserted verbatim, never re-typed by the model. */
  resultTable?: FatwaResultTable;
  /** The model-written ruling/evidence discussion — an HTML fragment (draft_section mode 'fatwa' produces ONLY this part). */
  rulingHtml?: string;
  /** The compute engine's own non-fatwā disclaimer (ZakatResult.note / FaraidResult.note). */
  disclaimer?: string;
  /** One signature line per name. Defaults to a single generic line. */
  muftiNames?: string[];
  /** Caller-supplied date string (shared/ never touches the system clock). */
  date?: string;
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
}

const CELL = 'border:1px solid #333; padding:4px 8px; text-align:right; vertical-align:top;';
const HEAD_CELL = `${CELL} background:#eee; font-weight:bold;`;

function tableHtml(t: FatwaResultTable): string {
  const head = `<tr>${t.columns.map((c) => `<th style="${HEAD_CELL}">${esc(c)}</th>`).join('')}</tr>`;
  const body = t.rows.map((r) => `<tr>${r.map((c) => `<td style="${CELL}">${esc(c)}</td>`).join('')}</tr>`).join('\n');
  const caption = t.caption
    ? `<p style="font-size:9pt; color:#555; margin:4px 0 0;">${esc(t.caption)}</p>`
    : '';
  return `<table style="border-collapse:collapse; width:100%; margin:8px 0; direction:rtl;">\n${head}\n${body}\n</table>\n${caption}`;
}

const HEADING = 'font-size:13pt; font-weight:bold; margin:16px 0 6px; border-bottom:1px solid #999; padding-bottom:2px;';

/**
 * Build the full fatwā document as an HTML fragment. Every figure that
 * reaches the page came from {@link resolveResultTable} (i.e. from the
 * compute engine's own JSON), never from the model's own retelling.
 */
export function buildFatwaHtml(input: FatwaTemplateInput): string {
  const parts: string[] = ['<div dir="rtl" style="text-align:right; font-family:inherit;">'];

  parts.push(
    '<div style="text-align:center; border-bottom:2px solid #000; padding-bottom:8px; margin-bottom:14px;">',
    `<p style="font-weight:bold; font-size:15pt; margin:0;">${esc(input.instituteName ?? 'دار الافتاء')}</p>`,
    '</div>',
  );

  parts.push('<p style="text-align:center; font-weight:bold; font-size:13pt; margin:4px 0 18px;">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</p>');

  if (input.date) {
    parts.push(`<p style="text-align:left; font-size:9pt; color:#555; margin:0 0 8px;">تاریخ: ${esc(input.date)}</p>`);
  }

  parts.push(`<h2 style="${HEADING}">سوال</h2>`, `<p>${esc(input.question)}</p>`);

  if (input.resultTable && input.resultTable.rows.length > 0) {
    parts.push(`<h2 style="${HEADING}">حساب</h2>`, tableHtml(input.resultTable));
  }

  parts.push(`<h2 style="${HEADING}">جواب</h2>`);
  parts.push(input.rulingHtml && input.rulingHtml.trim() ? input.rulingHtml : '<p><em>[جواب درج نہیں کیا گیا]</em></p>');

  if (input.disclaimer) {
    parts.push(`<p style="font-style:italic; font-size:9pt; color:#555; margin-top:16px; border-top:1px solid #ccc; padding-top:8px;">${esc(input.disclaimer)}</p>`);
  }

  const signers = input.muftiNames?.length ? input.muftiNames : ['مفتی صاحب'];
  parts.push('<div style="margin-top:36px;">');
  for (const name of signers) {
    parts.push(`<p style="margin:22px 0 0;">دستخط: ________________________&nbsp;&nbsp;(${esc(name)})</p>`);
  }
  parts.push('</div>', '</div>');

  return parts.join('\n');
}

/** {@link calculateZakat}'s result shape, duplicated locally (shared/faraid and shared/zakat are siblings — no cross-import to keep this a leaf module). */
interface ZakatResultLike {
  lines: Array<{ label: string; value: number; zakatable: number; dalil: string }>;
  zakatDue: number;
  currency?: string;
  note?: string;
}

/** {@link calculateFaraid}'s result shape, duplicated locally for the same reason. */
interface FaraidResultLike {
  lines: Array<{ label: string; count: number; fraction: string; perPerson?: string; dalil: string }>;
  asl: number;
  currency?: string;
  note?: string;
}

export function tableFromZakatResult(r: ZakatResultLike): FatwaResultTable {
  return {
    columns: ['مد', 'رقم', 'قابلِ زکوٰۃ', 'دلیل'],
    rows: [
      ...r.lines.map((l) => [l.label, String(l.value), String(l.zakatable), l.dalil]),
      ['واجب الادا زکوٰۃ', `${r.zakatDue}${r.currency ? ` ${r.currency}` : ''}`, '', ''],
    ],
  };
}

export function tableFromFaraidResult(r: FaraidResultLike): FatwaResultTable {
  return {
    columns: ['وارث', 'تعداد', 'حصہ (کل)', 'فی کس', 'دلیل'],
    rows: r.lines.map((l) => [l.label, String(l.count), l.fraction, l.perPerson ?? l.fraction, l.dalil]),
    caption: `اصل المسئلہ: ${r.asl}`,
  };
}

/**
 * Sniff a parsed JSON value into a {@link FatwaResultTable}: a plain
 * `{columns, rows}` table, a `ZakatResult` (has `zakatDue`), or a
 * `FaraidResult` (has `asl`) — whatever `calculate_zakat`/`calculate_faraid`
 * actually returned, copied verbatim by the caller. Returns `null` for
 * anything else rather than guessing.
 */
export function resolveResultTable(parsed: unknown): FatwaResultTable | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
    return {
      columns: obj.columns as string[],
      rows: obj.rows as string[][],
      caption: typeof obj.caption === 'string' ? obj.caption : undefined,
    };
  }
  if (typeof obj.zakatDue === 'number' && Array.isArray(obj.lines)) {
    return tableFromZakatResult(obj as unknown as ZakatResultLike);
  }
  if (typeof obj.asl === 'number' && Array.isArray(obj.lines)) {
    return tableFromFaraidResult(obj as unknown as FaraidResultLike);
  }
  return null;
}

/** The engine's own `note` field, when the parsed JSON carries one (a ZakatResult/FaraidResult always does). */
export function resolveDisclaimer(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const note = (parsed as Record<string, unknown>).note;
  return typeof note === 'string' && note.trim() ? note : undefined;
}
