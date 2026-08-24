import { describe, it, expect } from 'vitest';
import {
  parseAyah,
  parseTafsirList,
  parseQuranSearch,
  parseTafsirSearch,
  parseTafsirSources,
  rowsFromTextBlocks,
} from '../lib/tafsir/parseTafsir';

describe('parseTafsir — ayah (SPEC-TAFSIR §FR-5.3)', () => {
  it('uses structured content when present', () => {
    const row = parseAyah({
      text: '{"text":"fluff","surah":2,"ayah":255}',
      structured: { text: 'آیة الكرسي', surah: 2, ayah: 255 },
    });
    expect(row.text).toBe('آیة الكرسي');
    expect(row.reference).toBe('سورہ 2:255');
    expect(row.source).toBe('القرآن الكريم');
  });

  it('falls back to JSON in the text body', () => {
    const row = parseAyah({ text: '{"text":"نص","surah":1,"ayah":1}', structured: undefined });
    expect(row.text).toBe('نص');
    expect(row.reference).toBe('سورہ 1:1');
  });

  it('degrades to the raw text when nothing parses', () => {
    const row = parseAyah({ text: '  سادہ متن  ', structured: undefined });
    expect(row.text).toBe('سادہ متن');
  });

  it('does not leak raw JSON as ayah text on a shape mismatch', () => {
    // Valid JSON, but no `.text` field — must not surface the JSON itself.
    const row = parseAyah({ text: '{"surah":2,"ayah":255,"other":"x"}', structured: undefined });
    expect(row.text).toBe('');
    expect(row.reference).toBe('سورہ 2:255');
  });

  it('falls through to the text body when structured is empty', () => {
    const row = parseAyah({
      text: '{"text":"نص","surah":1,"ayah":1}',
      structured: {},
    });
    expect(row.text).toBe('نص');
    expect(row.reference).toBe('سورہ 1:1');
  });
});

describe('parseTafsir — tafsir list (SPEC-TAFSIR §FR-5.3)', () => {
  it('maps the tafsirs array with attribution', () => {
    const rows = parseTafsirList({
      text: '{"tafsirs":[]}',
      structured: {
        tafsirs: [
          { source: 'saadi', attribution: 'السعدي', text: '  نص  ' },
          { source: 'tabari', attribution: 'الطبري', text: '  ' },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: 'نص', source: 'السعدي' });
  });

  it('returns empty when the shape is absent', () => {
    expect(parseTafsirList({ text: 'plain', structured: undefined })).toEqual([]);
  });
});

describe('parseTafsir — searches', () => {
  it('parses quran text search results', () => {
    const rows = parseQuranSearch({
      text: '[{"surah":2,"ayah":255,"text":"آية"}]',
      structured: undefined,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: 'آية', reference: 'سورہ 2:255' });
  });

  it('parses in-tafsir search results with attribution', () => {
    const rows = parseTafsirSearch({
      text: '[{"text":"فقرہ","attribution":"السعدي"}]',
      structured: undefined,
    });
    expect(rows[0]).toMatchObject({ text: 'فقرہ', source: 'السعدي' });
  });

  it('handles snippet field for search results', () => {
    const rows = parseTafsirSearch({
      text: '[{"snippet":"مقتطف"}]',
      structured: undefined,
    });
    expect(rows[0].text).toBe('مقتطف');
  });

  it('unwraps a {results: […]} wrapper for quran search', () => {
    const rows = parseQuranSearch({
      text: '{"results":[{"surah":2,"ayah":255,"text":"آية"}]}',
      structured: undefined,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: 'آية', reference: 'سورہ 2:255' });
  });

  it('unwraps an {items: […]} wrapper for in-tafsir search', () => {
    const rows = parseTafsirSearch({
      text: '{"items":[{"text":"فقرہ","attribution":"السعدي"}]}',
      structured: undefined,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: 'فقرہ', source: 'السعدي' });
  });

  it('splits raw text into paragraph rows as a fallback', () => {
    const rows = rowsFromTextBlocks('پیرا ایک\n\nپیرا دو');
    expect(rows).toHaveLength(2);
  });
});

describe('parseTafsir — sources', () => {
  it('parses a bare array of sources', () => {
    const sources = parseTafsirSources({
      text: '[]',
      structured: [{ slug: 'saadi', attribution: 'السعدي' }, { slug: 'tabari', name: 'الطبري' }],
    });
    expect(sources).toEqual([
      { slug: 'saadi', label: 'السعدي' },
      { slug: 'tabari', label: 'الطبري' },
    ]);
  });

  it('unwraps an {items: […]} wrapper and drops entries without a slug', () => {
    const sources = parseTafsirSources({
      text: '{"items":[{"slug":"saadi","attribution":"السعدي"},{"attribution":"بدون سلاگ"}]}',
      structured: undefined,
    });
    expect(sources).toEqual([{ slug: 'saadi', label: 'السعدي' }]);
  });
});