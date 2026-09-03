// @vitest-environment node
// shared/research/citationTypes.ts formatScholarlyRef + the research bridge
// contract (M9 Phase 1, ADR-0022). The Islamic channel's citations must format
// into a source-precise reference; a ref with nothing citable yields null so
// the dispatcher drops it.
import { describe, it, expect } from 'vitest';
import { formatScholarlyRef } from '../../shared/research/citationTypes';

describe('formatScholarlyRef', () => {
  it('formats a hadith citation with collection, number, narrator, grade', () => {
    expect(formatScholarlyRef({ collection: 'صحيح البخاري', hadith_number: 1, rawi: 'عمر', grade: 'صحيح' }, 'hadith'))
      .toBe('صحيح البخاري 1، عن عمر، (صحيح)');
  });

  it('formats a Qur\'an citation as surah: ayah', () => {
    expect(formatScholarlyRef({ surah_name: 'البقرة', verse: 255 }, 'quran')).toBe('البقرة: 255');
  });

  it('formats a fatwa citation with scholar + number', () => {
    expect(formatScholarlyRef({ scholar: 'ابن باز', fatwa_number: '123' }, 'urdufatwa')).toBe('ابن باز، فتوى رقم 123');
  });

  it('formats a classical-work citation with author, title, volume, page', () => {
    expect(formatScholarlyRef({ author: 'الغزالي', title: 'إحياء علوم الدين', volume: 1, page: 40 }))
      .toBe('الغزالي، «إحياء علوم الدين»، ج1، ص40');
  });

  it('returns null when the ref carries nothing citable — the chunk is then dropped', () => {
    expect(formatScholarlyRef({}, 'hadith')).toBeNull();
    expect(formatScholarlyRef({ type: 'note' })).toBeNull();
  });
});
