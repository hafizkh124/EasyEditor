/**
 * M13 Phase 1 (ADR-0057) — the `automate_word_document` op list: parsing,
 * validation, paper presets, and the human-readable step lines the
 * approval card shows. Pure — no runtime globals, no Electron.
 *
 * `ToolParam` cannot express nested objects, so the model sends `ops` as a
 * JSON-encoded array (same convention as `build_spreadsheet.sheets`). Every
 * op is validated and normalised here BEFORE anything reaches Word: unknown
 * ops, oversize tables and empty find strings are rejected with a message
 * the model can correct from.
 */
import { TRIM_CM } from '../print/trimSizes.js';

export type WordOp =
  | { op: 'insertTable'; headers?: string[]; rows: string[][]; afterText?: string; rtl?: boolean }
  | { op: 'setFonts'; arabicFont?: string; urduFont?: string; latinFont?: string; sizePt?: number; scope?: 'styles' | 'paragraphs' }
  | { op: 'setPageSetup'; orientation?: 'portrait' | 'landscape'; pageWidthCm?: number; pageHeightCm?: number }
  | { op: 'findReplace'; find: string; replace: string; matchCase?: boolean; wholeWord?: boolean; matchDiacritics?: boolean; matchKashida?: boolean; matchAlefHamza?: boolean; maxReplacements?: number }
  | { op: 'insertPageNumbers'; position?: 'header' | 'footer'; alignment?: 'left' | 'center' | 'right'; numberStyle?: number; firstPage?: boolean };

export const MAX_OPS = 10;
export const MAX_TABLE_ROWS = 300;
export const MAX_TABLE_COLS = 15;
/** Word's Find.Text limit. */
export const MAX_FIND_CHARS = 255;

/** Portrait paper sizes in cm. Book trims come from trimSizes.ts. */
export const PAPER_CM: Record<string, { w: number; h: number; label: string }> = {
  a4: { w: 21.0, h: 29.7, label: 'A4' },
  a5: TRIM_CM.a5,
  b5: TRIM_CM.b5,
  letter: { w: 21.59, h: 27.94, label: 'US Letter' },
  legal: { w: 21.59, h: 35.56, label: 'US Legal' },
  royal: { w: 15.6, h: 23.4, label: 'Royal (15.6 × 23.4 cm)' },
  waziri: TRIM_CM.waziri,
  digest: TRIM_CM.digest,
};

/** Word page-number styles the tool exposes. */
export const NUMBER_STYLES = { western: 0, 'arabic-indic': 51 } as const;

const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const b = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Font names travel into Word as data, but keep them to a sane shape anyway. */
function fontName(v: unknown, field: string): string | undefined {
  const f = s(v);
  if (f === undefined) return undefined;
  if (f.length > 64 || /[\r\n\t"<>]/.test(f)) throw new Error(`${field}: not a valid font name`);
  return f;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Parse + validate one op; throws with a correctable message. */
export function normaliseWordOp(raw: unknown, index: number): WordOp {
  if (!raw || typeof raw !== 'object') throw new Error(`ops[${index}] must be an object`);
  const o = raw as Record<string, unknown>;
  const where = `ops[${index}] (${String(o.op)})`;
  switch (o.op) {
    case 'insertTable': {
      const rows = Array.isArray(o.rows) ? o.rows.map((r) => (Array.isArray(r) ? r.map(cellText) : [cellText(r)])) : [];
      const headers = Array.isArray(o.headers) ? o.headers.map(cellText) : undefined;
      const cols = Math.max(headers?.length ?? 0, ...rows.map((r) => r.length), 0);
      if (cols === 0) throw new Error(`${where}: give headers and/or rows`);
      if (cols > MAX_TABLE_COLS) throw new Error(`${where}: at most ${MAX_TABLE_COLS} columns`);
      if (rows.length + (headers?.length ? 1 : 0) > MAX_TABLE_ROWS) throw new Error(`${where}: at most ${MAX_TABLE_ROWS} rows`);
      return { op: 'insertTable', headers, rows, afterText: s(o.afterText)?.slice(0, MAX_FIND_CHARS), rtl: b(o.rtl) ?? true };
    }
    case 'setFonts': {
      const out: WordOp = {
        op: 'setFonts',
        arabicFont: fontName(o.arabicFont, 'arabicFont'),
        urduFont: fontName(o.urduFont, 'urduFont'),
        latinFont: fontName(o.latinFont, 'latinFont'),
        sizePt: n(o.sizePt),
        scope: o.scope === 'paragraphs' ? 'paragraphs' : 'styles',
      };
      if (!out.arabicFont && !out.urduFont && !out.latinFont) throw new Error(`${where}: name at least one of arabicFont / urduFont / latinFont`);
      if (out.sizePt !== undefined && (out.sizePt < 6 || out.sizePt > 72)) throw new Error(`${where}: sizePt must be 6–72`);
      return out;
    }
    case 'setPageSetup': {
      const orientation = o.orientation === 'landscape' ? 'landscape' : o.orientation === 'portrait' ? 'portrait' : undefined;
      let w = n(o.pageWidthCm);
      let h = n(o.pageHeightCm);
      const paper = s(o.paper)?.toLowerCase();
      if (paper) {
        const p = PAPER_CM[paper];
        if (!p) throw new Error(`${where}: unknown paper "${paper}" (use ${Object.keys(PAPER_CM).join(', ')}, or pageWidthCm + pageHeightCm)`);
        w = p.w; h = p.h;
      }
      if ((w === undefined) !== (h === undefined)) throw new Error(`${where}: give both pageWidthCm and pageHeightCm`);
      if (w !== undefined && h !== undefined) {
        if (w < 5 || h < 5 || w > 60 || h > 60) throw new Error(`${where}: page size out of range`);
        // Width/height are sent already oriented — Word swaps them itself on an
        // Orientation flip, and the bridge sets orientation first.
        if (orientation === 'landscape' && w < h) [w, h] = [h, w];
        if (orientation === 'portrait' && w > h) [w, h] = [h, w];
      }
      if (!orientation && w === undefined) throw new Error(`${where}: give orientation and/or a paper size`);
      return { op: 'setPageSetup', orientation, pageWidthCm: w, pageHeightCm: h };
    }
    case 'findReplace': {
      const find = typeof o.find === 'string' ? o.find : '';
      if (!find) throw new Error(`${where}: find is empty`);
      if (find.length > MAX_FIND_CHARS) throw new Error(`${where}: find is longer than ${MAX_FIND_CHARS} characters`);
      const replace = typeof o.replace === 'string' ? o.replace : '';
      if (replace.length > MAX_FIND_CHARS) throw new Error(`${where}: replace is longer than ${MAX_FIND_CHARS} characters`);
      return {
        op: 'findReplace', find, replace,
        matchCase: b(o.matchCase), wholeWord: b(o.wholeWord),
        matchDiacritics: b(o.matchDiacritics), matchKashida: b(o.matchKashida), matchAlefHamza: b(o.matchAlefHamza),
        maxReplacements: Math.min(Math.max(n(o.maxReplacements) ?? 2000, 1), 5000),
      };
    }
    case 'insertPageNumbers': {
      const style = s(o.numberStyle) as keyof typeof NUMBER_STYLES | undefined;
      return {
        op: 'insertPageNumbers',
        position: o.position === 'header' ? 'header' : 'footer',
        alignment: o.alignment === 'left' || o.alignment === 'right' ? o.alignment : 'center',
        numberStyle: style && style in NUMBER_STYLES ? NUMBER_STYLES[style] : 0,
        firstPage: b(o.firstPage) ?? true,
      };
    }
    default:
      throw new Error(`${where}: unknown op — use insertTable, setFonts, setPageSetup, findReplace or insertPageNumbers`);
  }
}

/** Parse the tool's `ops` argument (a JSON string, or an array from a lenient provider). */
export function parseWordOps(arg: unknown): WordOp[] {
  let raw: unknown = arg;
  if (typeof arg === 'string') {
    try { raw = JSON.parse(arg); } catch { throw new Error('ops must be a JSON array, e.g. [{"op":"insertTable","headers":["a","b"],"rows":[["1","2"]]}]'); }
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('ops must be a non-empty JSON array');
  if (raw.length > MAX_OPS) throw new Error(`at most ${MAX_OPS} ops per call`);
  return raw.map((r, i) => normaliseWordOp(r, i));
}

/** One Urdu line per op for the approval card and progress ticks. */
export function describeWordOp(op: WordOp): string {
  switch (op.op) {
    case 'insertTable': {
      const cols = Math.max(op.headers?.length ?? 0, ...op.rows.map((r) => r.length));
      const rows = op.rows.length + (op.headers?.length ? 1 : 0);
      return `${rows}×${cols} کی ٹیبل داخل کرنا${op.afterText ? ` («${op.afterText.slice(0, 30)}» کے بعد)` : ' (آخر میں)'}${op.rtl ? '، دائیں سے بائیں' : ''}`;
    }
    case 'setFonts': {
      const parts = [
        op.urduFont && `اردو: ${op.urduFont}`,
        op.arabicFont && `عربی: ${op.arabicFont}`,
        op.latinFont && `لاطینی: ${op.latinFont}`,
        op.sizePt && `سائز ${op.sizePt}`,
      ].filter(Boolean);
      return `فونٹ سیٹ کرنا — ${parts.join('، ')}`;
    }
    case 'setPageSetup': {
      const parts = [
        op.orientation === 'landscape' ? 'افقی (landscape)' : op.orientation === 'portrait' ? 'عمودی (portrait)' : null,
        op.pageWidthCm && op.pageHeightCm ? `${op.pageWidthCm} × ${op.pageHeightCm} سم` : null,
      ].filter(Boolean);
      return `صفحے کی ترتیب — ${parts.join('، ')}`;
    }
    case 'findReplace':
      return `«${op.find.slice(0, 40)}» کو «${op.replace.slice(0, 40)}» سے بدلنا (ٹریک شدہ)`;
    case 'insertPageNumbers':
      return `صفحہ نمبر ${op.position === 'header' ? 'ہیڈر' : 'فوٹر'} میں${op.numberStyle === NUMBER_STYLES['arabic-indic'] ? ' (١ ٢ ٣)' : ''}`;
  }
}
