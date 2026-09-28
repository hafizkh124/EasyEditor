// M13 Phase 1 (ADR-0057) — the automate_word_document op list is validated
// and normalised BEFORE anything reaches Word.
import { describe, it, expect } from 'vitest';
import { parseWordOps, describeWordOp, NUMBER_STYLES, MAX_OPS, PAPER_CM } from '../../shared/agent/wordAutomation';

describe('parseWordOps', () => {
  it('accepts a JSON string and an array', () => {
    const json = JSON.stringify([{ op: 'insertTable', headers: ['نام', 'حوالہ'], rows: [['بخاری', '1']] }]);
    expect(parseWordOps(json)).toHaveLength(1);
    expect(parseWordOps([{ op: 'findReplace', find: 'a', replace: 'b' }])[0]).toMatchObject({ op: 'findReplace', find: 'a', replace: 'b' });
  });

  it('rejects junk with a message the model can correct from', () => {
    expect(() => parseWordOps('not json')).toThrow(/JSON array/);
    expect(() => parseWordOps('[]')).toThrow(/non-empty/);
    expect(() => parseWordOps([{ op: 'deleteEverything' }])).toThrow(/unknown op/);
    expect(() => parseWordOps(Array.from({ length: MAX_OPS + 1 }, () => ({ op: 'insertPageNumbers' })))).toThrow(/at most/);
  });

  it('insertTable: stringifies cells, defaults to RTL, bounds the size', () => {
    const [t] = parseWordOps([{ op: 'insertTable', rows: [[1, null, true]] }]);
    expect(t).toMatchObject({ op: 'insertTable', rows: [['1', '', 'true']], rtl: true });
    expect(() => parseWordOps([{ op: 'insertTable', rows: [] }])).toThrow(/headers and\/or rows/);
    expect(() => parseWordOps([{ op: 'insertTable', rows: [Array(16).fill('x')] }])).toThrow(/columns/);
  });

  it('setFonts: needs a font, rejects odd names and sizes', () => {
    expect(() => parseWordOps([{ op: 'setFonts' }])).toThrow(/at least one/);
    expect(() => parseWordOps([{ op: 'setFonts', urduFont: 'x"; evil' }])).toThrow(/font name/);
    expect(() => parseWordOps([{ op: 'setFonts', urduFont: 'Jameel Noori Nastaleeq', sizePt: 200 }])).toThrow(/sizePt/);
    expect(parseWordOps([{ op: 'setFonts', urduFont: 'Jameel Noori Nastaleeq', arabicFont: 'Amiri' }])[0])
      .toMatchObject({ urduFont: 'Jameel Noori Nastaleeq', arabicFont: 'Amiri', scope: 'styles' });
  });

  it('setPageSetup: resolves paper presets and orients width/height', () => {
    const [land] = parseWordOps([{ op: 'setPageSetup', orientation: 'landscape', paper: 'A4' }]);
    expect(land).toEqual({ op: 'setPageSetup', orientation: 'landscape', pageWidthCm: PAPER_CM.a4.h, pageHeightCm: PAPER_CM.a4.w });
    const [port] = parseWordOps([{ op: 'setPageSetup', paper: 'royal' }]);
    expect(port).toMatchObject({ pageWidthCm: 15.6, pageHeightCm: 23.4 });
    expect(() => parseWordOps([{ op: 'setPageSetup', paper: 'napkin' }])).toThrow(/unknown paper/);
    expect(() => parseWordOps([{ op: 'setPageSetup', pageWidthCm: 20 }])).toThrow(/both/);
    expect(() => parseWordOps([{ op: 'setPageSetup' }])).toThrow(/orientation/);
  });

  it('findReplace: refuses empty / over-long find text', () => {
    expect(() => parseWordOps([{ op: 'findReplace', find: '', replace: 'x' }])).toThrow(/empty/);
    expect(() => parseWordOps([{ op: 'findReplace', find: 'x'.repeat(256), replace: '' }])).toThrow(/255/);
  });

  it('insertPageNumbers: maps the numeral style name to Word\'s constant', () => {
    const [p] = parseWordOps([{ op: 'insertPageNumbers', numberStyle: 'arabic-indic' }]);
    expect(p).toMatchObject({ position: 'footer', alignment: 'center', numberStyle: NUMBER_STYLES['arabic-indic'] });
  });
});

describe('describeWordOp', () => {
  it('renders one Urdu line per op for the approval card', () => {
    const ops = parseWordOps([
      { op: 'insertTable', headers: ['a', 'b', 'c'], rows: [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']] },
      { op: 'setFonts', urduFont: 'Jameel Noori Nastaleeq' },
    ]);
    expect(describeWordOp(ops[0])).toContain('4×3');
    expect(describeWordOp(ops[1])).toContain('Jameel Noori Nastaleeq');
  });
});
