// @vitest-environment node
// shared/convert/citationFootnotes.ts — M8 P6. The integrity gate is the
// whole point: the footnote text must come from the verified `sources` array,
// NEVER from reference text that happens to sit in the document. Also: each
// distinct in-range [N] produces exactly one footnote entry (Word finds every
// occurrence itself), and an out-of-range or empty-reference marker is
// reported in `unresolved`, not silently footnoted with junk.
import { describe, it, expect } from 'vitest';
import { buildCitationFootnotes } from '../../shared/convert/citationFootnotes';

const sources = [
  { reference: 'Sahih Bukhari #1', source_url: 'https://x/1' },
  { reference: 'Sahih Muslim #2' },
  { reference: 'Quran Al-Baqarah 2:255', source_url: null },
];

describe('buildCitationFootnotes', () => {
  it('pairs each [N] with sources[N-1], appending the URL when present', () => {
    const { footnotes, unresolved } = buildCitationFootnotes('text [1] more [2] end [3]', sources);
    expect(unresolved).toEqual([]);
    expect(footnotes).toEqual([
      { marker: '[1]', text: 'Sahih Bukhari #1 — https://x/1' },
      { marker: '[2]', text: 'Sahih Muslim #2' },
      { marker: '[3]', text: 'Quran Al-Baqarah 2:255' },
    ]);
  });

  it('uses the verified source, NOT any reference text in the document', () => {
    const doc = 'Per the hadith [1] (which the model typed as "Fabricated Source #999").';
    const { footnotes } = buildCitationFootnotes(doc, sources);
    expect(footnotes[0].text).toBe('Sahih Bukhari #1 — https://x/1');
    expect(footnotes[0].text).not.toContain('999');
  });

  it('emits one entry per distinct marker even when [N] repeats', () => {
    const { footnotes } = buildCitationFootnotes('[1] ... [2] ... [1] again', sources);
    expect(footnotes.map((f) => f.marker)).toEqual(['[1]', '[2]']);
  });

  it('keeps order of first appearance, not numeric order', () => {
    const { footnotes } = buildCitationFootnotes('see [3] then [1]', sources);
    expect(footnotes.map((f) => f.marker)).toEqual(['[3]', '[1]']);
  });

  it('reports an out-of-range marker as unresolved with no footnote', () => {
    const { footnotes, unresolved } = buildCitationFootnotes('[1] and [9]', sources);
    expect(footnotes.map((f) => f.marker)).toEqual(['[1]']);
    expect(unresolved).toEqual([9]);
  });

  it('reports a marker whose source has an empty reference as unresolved', () => {
    const { footnotes, unresolved } = buildCitationFootnotes('[1] [2]', [
      { reference: 'ok' },
      { reference: '  ' },
    ]);
    expect(footnotes.map((f) => f.marker)).toEqual(['[1]']);
    expect(unresolved).toEqual([2]);
  });

  it('returns nothing for text with no markers', () => {
    expect(buildCitationFootnotes('no markers here', sources)).toEqual({ footnotes: [], unresolved: [] });
  });
});
