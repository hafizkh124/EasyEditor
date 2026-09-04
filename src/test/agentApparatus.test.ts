// @vitest-environment node
// shared/research/apparatus.ts (M9 Phase 6). Word's Compare gives interleaved
// insert/delete revisions; a substitution is a delete immediately followed by
// an insert. buildApparatus pairs those into loci; apparatusTable renders them
// as an apparatus criticus, not a raw diff.
import { describe, it, expect } from 'vitest';
import { buildApparatus, apparatusTable, type Revision } from '../../shared/research/apparatus';

const rev = (type: Revision['type'], text: string, context = '', page = 1): Revision => ({ type, text, context, page });

describe('buildApparatus', () => {
  it('pairs a delete+insert into one substitution locus', () => {
    const loci = buildApparatus([
      rev('delete', 'العِلمُ نورٌ', '… قال العِلمُ نورٌ يهدي …', 3),
      rev('insert', 'العِلمُ ضياءٌ', '… قال العِلمُ ضياءٌ يهدي …', 3),
    ]);
    expect(loci).toHaveLength(1);
    expect(loci[0]).toMatchObject({ index: 1, page: 3, base: 'العِلمُ نورٌ', witness: 'العِلمُ ضياءٌ', kind: 'substitution' });
  });

  it('a lone insert is an addition in the witness; a lone delete is an omission', () => {
    const loci = buildApparatus([
      rev('insert', 'رحمه الله', '', 4),
      rev('delete', 'وقيل غير ذلك', '', 5),
    ]);
    expect(loci.map((l) => l.kind)).toEqual(['addition', 'omission']);
    expect(loci[0]).toMatchObject({ base: '', witness: 'رحمه الله' });
    expect(loci[1]).toMatchObject({ base: 'وقيل غير ذلك', witness: '' });
  });

  it('numbers loci in reading order and collapses whitespace', () => {
    const loci = buildApparatus([
      rev('insert', '  a  b  '),
      rev('delete', 'x'), rev('insert', 'y'),
      rev('delete', 'z'),
    ]);
    expect(loci.map((l) => l.index)).toEqual([1, 2, 3]);
    expect(loci[0].witness).toBe('a b');
    expect(loci[1].kind).toBe('substitution'); // the delete+insert pair
    expect(loci[2].kind).toBe('omission');
  });

  it('an identical pair of witnesses yields an empty apparatus', () => {
    expect(buildApparatus([])).toEqual([]);
  });
});

describe('apparatusTable', () => {
  it('labels the witness column with the siglum and renders one row per locus', () => {
    const loci = buildApparatus([rev('delete', 'نورٌ', '', 2), rev('insert', 'ضياءٌ', '', 2)]);
    const t = apparatusTable(loci, 'ح');
    expect(t.columns[3]).toBe('نسخة ح');
    expect(t.rows[0]).toEqual(['1', '2', 'نورٌ', 'ضياءٌ', 'استبدال', '']);
  });

  it('defaults the siglum to ب', () => {
    expect(apparatusTable([], '').columns[3]).toBe('نسخة ب');
  });
});
