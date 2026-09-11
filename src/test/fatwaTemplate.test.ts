/**
 * M12 Phase E — shared/print/fatwaTemplate.ts: a DETERMINISTIC HTML builder,
 * not a model prompt. Pins the document structure and, crucially, that every
 * figure in the results table comes from {@link resolveResultTable}'s own
 * sniffing of a ZakatResult/FaraidResult shape — never from prose.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  buildFatwaHtml, resolveResultTable, resolveDisclaimer,
  tableFromZakatResult, tableFromFaraidResult,
} from '~shared/print/fatwaTemplate';

describe('buildFatwaHtml — structure', () => {
  it('always carries the bismillah, the letterhead, the verbatim question, and a signature line', () => {
    const html = buildFatwaHtml({ question: 'کیا میری آمدنی پر زکوٰۃ واجب ہے؟' });
    expect(html).toContain('بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ');
    expect(html).toContain('دار الافتاء'); // default letterhead
    expect(html).toContain('کیا میری آمدنی پر زکوٰۃ واجب ہے؟');
    expect(html).toContain('دستخط:');
    expect(html).toContain('مفتی صاحب'); // default signer
  });

  it('escapes the question and institute name (never raw HTML from a user field)', () => {
    const html = buildFatwaHtml({ question: '<script>alert(1)</script>', instituteName: 'A & B' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('a custom institute name and multiple mufti signature lines', () => {
    const html = buildFatwaHtml({ question: 'س', instituteName: 'دار الافتاء، جامعہ فلاں', muftiNames: ['مفتی احمد', 'مفتی محمود'] });
    expect(html).toContain('دار الافتاء، جامعہ فلاں');
    expect(html).toContain('مفتی احمد');
    expect(html).toContain('مفتی محمود');
    expect(html.match(/دستخط:/g)).toHaveLength(2);
  });

  it('omits the "حساب" table section entirely when no resultTable is given', () => {
    const html = buildFatwaHtml({ question: 'س' });
    expect(html).not.toContain('<table');
  });

  it('renders a resultTable verbatim — the numbers come from the table, never from rulingHtml', () => {
    const html = buildFatwaHtml({
      question: 'س',
      resultTable: { columns: ['مد', 'رقم'], rows: [['نقد', '100000']], caption: 'اصل المسئلہ: 6' },
      rulingHtml: '<p>یہ زکوٰۃ واجب ہے۔</p>',
    });
    expect(html).toContain('<table');
    expect(html).toContain('نقد');
    expect(html).toContain('100000');
    expect(html).toContain('اصل المسئلہ: 6');
    expect(html).toContain('یہ زکوٰۃ واجب ہے۔');
  });

  it('the ruling section falls back to a placeholder when rulingHtml is empty/whitespace', () => {
    expect(buildFatwaHtml({ question: 'س' })).toContain('جواب درج نہیں کیا گیا');
    expect(buildFatwaHtml({ question: 'س', rulingHtml: '   ' })).toContain('جواب درج نہیں کیا گیا');
  });

  it('the ruling HTML is inserted as-is (it is already HTML, not escaped)', () => {
    const html = buildFatwaHtml({ question: 'س', rulingHtml: '<p><strong>راجح</strong> قول یہ ہے۔</p>' });
    expect(html).toContain('<p><strong>راجح</strong> قول یہ ہے۔</p>');
  });

  it('renders the disclaimer when given', () => {
    const html = buildFatwaHtml({ question: 'س', disclaimer: 'یہ فتویٰ نہیں، حساب ہے۔' });
    expect(html).toContain('یہ فتویٰ نہیں، حساب ہے۔');
  });

  it('the whole document is RTL', () => {
    expect(buildFatwaHtml({ question: 'س' })).toMatch(/dir="rtl"/);
  });

  it('uses inline styles, not CSS classes — Word\'s HTML import does not see an external stylesheet', () => {
    const html = buildFatwaHtml({
      question: 'س',
      resultTable: { columns: ['a'], rows: [['1']] },
    });
    expect(html).not.toMatch(/class="/);
    expect(html).toMatch(/style="/);
  });
});

describe('tableFromZakatResult / tableFromFaraidResult', () => {
  it('zakat: every line plus a final zakatDue row', () => {
    const t = tableFromZakatResult({
      lines: [{ label: 'نقد', value: 100000, zakatable: 100000, dalil: 'x' }],
      zakatDue: 2500,
      currency: 'PKR',
    });
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]).toEqual(['واجب الادا زکوٰۃ', '2500 PKR', '', '']);
  });

  it('faraid: one row per heir line, asl in the caption', () => {
    const t = tableFromFaraidResult({
      lines: [{ label: 'بیوی', count: 1, fraction: '1/8', dalil: 'x' }],
      asl: 8,
    });
    expect(t.rows).toEqual([['بیوی', '1', '1/8', '1/8', 'x']]);
    expect(t.caption).toBe('اصل المسئلہ: 8');
  });
});

describe('resolveResultTable — sniffs a parsed calculate_zakat/calculate_faraid JSON', () => {
  it('a plain {columns, rows} table passes through', () => {
    const t = resolveResultTable({ columns: ['a'], rows: [['1']], caption: 'c' });
    expect(t).toEqual({ columns: ['a'], rows: [['1']], caption: 'c' });
  });

  it('a ZakatResult (has zakatDue) is converted', () => {
    const t = resolveResultTable({ lines: [{ label: 'x', value: 1, zakatable: 1, dalil: 'd' }], zakatDue: 1 });
    expect(t?.columns).toEqual(['مد', 'رقم', 'قابلِ زکوٰۃ', 'دلیل']);
  });

  it('a FaraidResult (has asl) is converted', () => {
    const t = resolveResultTable({ lines: [{ label: 'x', count: 1, fraction: '1/2', dalil: 'd' }], asl: 2 });
    expect(t?.columns).toEqual(['وارث', 'تعداد', 'حصہ (کل)', 'فی کس', 'دلیل']);
  });

  it('anything else (or non-object/null) resolves to null, never a guess', () => {
    expect(resolveResultTable(null)).toBeNull();
    expect(resolveResultTable('a string')).toBeNull();
    expect(resolveResultTable({ foo: 'bar' })).toBeNull();
    expect(resolveResultTable(42)).toBeNull();
  });
});

describe('resolveDisclaimer', () => {
  it('reads the .note field of a parsed result', () => {
    expect(resolveDisclaimer({ note: 'یہ فتویٰ نہیں۔' })).toBe('یہ فتویٰ نہیں۔');
  });

  it('undefined for a missing, blank, or non-string note', () => {
    expect(resolveDisclaimer({})).toBeUndefined();
    expect(resolveDisclaimer({ note: '   ' })).toBeUndefined();
    expect(resolveDisclaimer({ note: 5 })).toBeUndefined();
    expect(resolveDisclaimer(null)).toBeUndefined();
  });
});
