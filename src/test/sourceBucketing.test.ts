import { describe, it, expect } from 'vitest';
import { sourceTypeOf } from '../components/editor/useResourceSearch';
import type { ResourceResult } from '../lib/editor/citationFormat';

const row = (r: Partial<ResourceResult>): ResourceResult =>
  ({ content: 'x', citation_ref: {}, ...r }) as ResourceResult;

describe('sourceTypeOf — evidenced buckets', () => {
  it('tags Shamela rows from source_type', () => {
    expect(sourceTypeOf(row({ source_type: 'shamela' }))).toBe('shamela');
  });

  it('still recognises legacy Shamela rows by match_key / reason', () => {
    expect(sourceTypeOf(row({ match_key: 'shamela-42-15-0' }))).toBe('shamela');
    expect(sourceTypeOf(row({ reason: 'مکتبہ شاملہ (آف لائن) — كتاب' }))).toBe('shamela');
  });

  it('tags Tafsir rows', () => {
    expect(sourceTypeOf(row({ source_type: 'tafsir' }))).toBe('tafsir');
    expect(sourceTypeOf(row({ match_key: 'tafsir-search-3' }))).toBe('tafsir');
  });

  it('tags Quran rows by source_type or surah number', () => {
    expect(sourceTypeOf(row({ source_type: 'quran' }))).toBe('quran');
    expect(sourceTypeOf(row({ citation_ref: { surah_number: 2, verse: 255 } }))).toBe('quran');
  });

  it('tags hadith only on real hadith evidence', () => {
    expect(sourceTypeOf(row({ source_type: 'hadith' }))).toBe('hadith');
    expect(sourceTypeOf(row({ citation_ref: { collection: 'bukhari' } }))).toBe('hadith');
    expect(sourceTypeOf(row({ citation_ref: { hadith_number: 1421 } }))).toBe('hadith');
    expect(sourceTypeOf(row({ citation_ref: { grade: 'صحيح' } }))).toBe('hadith');
    expect(sourceTypeOf(row({ citation_ref: { rawi: 'ابن عمر' } }))).toBe('hadith');
  });

  it('does NOT call a book-and-page row hadith', () => {
    // The live regression: "Tajweedi-Qaida, p. 1487" — a tajweed primer that
    // used to display under the Hadith chip purely because it was the
    // catch-all arm.
    expect(sourceTypeOf(row({ citation_ref: { book: 'Tajweedi-Qaida', page: 1487 } }))).toBe('other');
  });

  it('routes other classical disciplines out of hadith too', () => {
    expect(sourceTypeOf(row({ source_type: 'fatwa' }))).toBe('other');
    expect(sourceTypeOf(row({ source_type: 'classical' }))).toBe('other');
    expect(sourceTypeOf(row({}))).toBe('other');
  });
});
