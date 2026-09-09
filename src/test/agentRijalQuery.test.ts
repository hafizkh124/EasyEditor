// @vitest-environment node
// shared/agent/rijalQuery.ts (ADR-0041) — lookup_narrator reuses the corpus's
// existing rijāl biographies; this shapes {name, aspect} into a query that
// islamic-search's Tier D auto-detects as a رجال question.
import { describe, it, expect } from 'vitest';
import { buildRijalQuery } from '../../shared/agent/rijalQuery';

describe('buildRijalQuery', () => {
  it('always names the narrator and reads as a rijāl question', () => {
    const q = buildRijalQuery('شعبة بن الحجاج');
    expect(q).toContain('شعبة بن الحجاج');
    expect(q).toMatch(/رجال/);
    expect(q).toMatch(/ترجمة الراوي/);
  });

  it('the aspect steers the focus phrase', () => {
    expect(buildRijalQuery('الأعمش', 'grade')).toMatch(/الجرح والتعديل/);
    expect(buildRijalQuery('الأعمش', 'teachers-students')).toMatch(/شيوخه وتلاميذه/);
    expect(buildRijalQuery('الأعمش', 'narration-count')).toMatch(/كم حديثًا روى/);
  });

  it('defaults to a biography focus and trims the name', () => {
    const q = buildRijalQuery('  أبو هريرة  ');
    expect(q).toContain('«أبو هريرة»');
    expect(q).toMatch(/ترجمته ونسبه/);
  });
});
