// @vitest-environment node
// shared/mentions/index.ts — `@` mentions (SPEC-M8 Layer 7, ADR-0019 item 1).
// A mention gives the agent an EXPLICIT reference so it doesn't guess which
// file "@Ihya" means. What must hold: the active `@token` is only detected
// when the caret is inside it and the `@` starts a word; applying a mention
// replaces just that token and leaves a trailing space.
import { describe, it, expect } from 'vitest';
import { buildMentions, filterMentions, activeMentionQuery, applyMention } from '../../shared/mentions';

describe('buildMentions', () => {
  it('turns chapters, outline headings, and Shamela books into mentions', () => {
    const m = buildMentions({
      chapters: ['01-intro.docx', '02-body.docx'],
      outline: ['المقدمة', '  '],
      shamelaBooks: [{ id: '55', title: 'صحيح البخاري' }],
    });
    expect(m).toEqual([
      { kind: 'chapter', label: '01-intro.docx', ref: '01-intro.docx' },
      { kind: 'chapter', label: '02-body.docx', ref: '02-body.docx' },
      { kind: 'heading', label: '§ المقدمة', ref: 'المقدمة' },
      { kind: 'shamela-book', label: 'صحيح البخاري', ref: 'shamela:55' },
    ]);
  });
});

describe('buildMentions — M9 Phase 3 assets', () => {
  it('surfaces recordings, scans, and other assets with a basename label and in-project ref', () => {
    const m = buildMentions({
      assets: [
        { name: 'media/lecture_01.mp3', kind: 'media' },
        { name: 'sources/page-01.jpg', kind: 'scan' },
        { name: 'sources/JameelNoori.ttf', kind: 'asset' },
      ],
    });
    expect(m).toEqual([
      { kind: 'media', label: 'lecture_01.mp3', ref: 'media/lecture_01.mp3' },
      { kind: 'scan', label: 'page-01.jpg', ref: 'sources/page-01.jpg' },
      { kind: 'asset', label: 'JameelNoori.ttf', ref: 'sources/JameelNoori.ttf' },
    ]);
  });

  it('a dropped recording is matchable by name alongside chapters', () => {
    const m = buildMentions({ chapters: ['01.docx'], assets: [{ name: 'media/ders.mp3', kind: 'media' }] });
    expect(filterMentions(m, 'ders').map((x) => x.kind)).toEqual(['media']);
  });
});

describe('filterMentions', () => {
  const m = buildMentions({ chapters: ['01-intro.docx', '02-body.docx', 'appendix.docx'] });
  it('substring-matches label or ref, case-insensitive', () => {
    expect(filterMentions(m, 'body').map((x) => x.label)).toEqual(['02-body.docx']);
    expect(filterMentions(m, 'DOCX')).toHaveLength(3);
  });
  it('returns everything (capped) for an empty query', () => {
    expect(filterMentions(m, '  ')).toHaveLength(3);
  });
  it('matches across chapters, outline headings, and Shamela books together', () => {
    const mixed = buildMentions({
      chapters: ['01-intro.docx'],
      outline: ['نظرية المعرفة', 'الخاتمة'],
      shamelaBooks: [{ id: '9', title: 'الموافقات' }],
    });
    // "معرفة" hits only the heading; "الم" (al-…) hits the heading + the book.
    expect(filterMentions(mixed, 'معرفة').map((x) => x.kind)).toEqual(['heading']);
    expect(filterMentions(mixed, 'الم').map((x) => x.kind).sort()).toEqual(['heading', 'shamela-book']);
  });
});

describe('activeMentionQuery', () => {
  it('finds the @token the caret is inside', () => {
    const text = 'fix @intro please';
    expect(activeMentionQuery(text, 10)).toEqual({ query: 'intro', start: 4 });
  });
  it('is null once a space ends the token', () => {
    expect(activeMentionQuery('fix @intro please', 17)).toBeNull();
  });
  it('is null when @ is mid-word (an email, not a mention)', () => {
    expect(activeMentionQuery('mail me@x', 9)).toBeNull();
  });
  it('is null with no @ at all', () => {
    expect(activeMentionQuery('just text', 4)).toBeNull();
  });
});

describe('applyMention', () => {
  it('replaces the active @query with @label and a trailing space', () => {
    const res = applyMention('add a footnote to @in', 21, { kind: 'chapter', label: '01-intro.docx', ref: '01-intro.docx' });
    expect(res.text).toBe('add a footnote to @01-intro.docx ');
    expect(res.caret).toBe(res.text.length);
  });
  it('keeps text after the caret intact', () => {
    const res = applyMention('@in and more', 3, { kind: 'chapter', label: 'intro.docx', ref: 'intro.docx' });
    expect(res.text).toBe('@intro.docx  and more');
  });
  it('inserts the full in-project ref for a media/scan asset, not just its basename label', () => {
    // A real bug: inserting the label alone ("lecture_01.mp3") gave the model
    // no way to resolve it — transcribe_media / ocr_document need the actual
    // "media/…" / "sources/…" path.
    const res = applyMention('transcribe @lec', 15, { kind: 'media', label: 'lecture_01.mp3', ref: 'media/lecture_01.mp3' });
    expect(res.text).toBe('transcribe @media/lecture_01.mp3 ');
  });
  it('keeps the title (label), not the internal id, for a Shamela-book mention', () => {
    // search_shamela only takes a free-text query — no tool takes a
    // "shamela:<id>" parameter, so the id would be useless to the model.
    const res = applyMention('check @bukh', 11, { kind: 'shamela-book', label: 'صحيح البخاري', ref: 'shamela:55' });
    expect(res.text).toBe('check @صحيح البخاري ');
  });
});
