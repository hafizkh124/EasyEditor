// M13 Phase 3 (ADR-0058) — the deterministic Shamela reference.
import { describe, it, expect } from 'vitest';
import { formatShamelaReference, volumePageLabel, deathLabel } from '../../shared/citation/shamelaFootnote';

describe('formatShamelaReference', () => {
  it('author (death), title, volume, printed page for a multi-volume book', () => {
    expect(formatShamelaReference({
      title: 'صحيح البخاري', author: 'البخاري', deathYear: 256, volume: '1', multiVolume: true, printedPage: 6, internalPage: 9,
    })).toBe('البخاري (ت 256هـ)، صحيح البخاري، ج 1، ص 6');
  });

  it('omits the volume for a single-volume book and the death year when unknown (99999)', () => {
    expect(formatShamelaReference({ title: 'الأربعون النووية', author: 'النووي', deathYear: 99999, volume: '1', multiVolume: false, printedPage: 12 }))
      .toBe('النووي، الأربعون النووية، ص 12');
  });

  it('falls back to the internal page id, labelled as Shamela numbering', () => {
    expect(volumePageLabel({ printedPage: null, internalPage: 340 })).toBe('ص 340 (ترقيم الشاملة)');
  });

  it('keeps a non-numeric part label as-is (e.g. an introduction volume)', () => {
    expect(volumePageLabel({ volume: 'المقدمة', multiVolume: true, printedPage: 3 })).toBe('المقدمة، ص 3');
  });

  it('never invents an author', () => {
    expect(formatShamelaReference({ title: 'كتاب', printedPage: 1 })).toBe('كتاب، ص 1');
    expect(deathLabel(0)).toBe('');
  });
});
