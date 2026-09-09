// @vitest-environment node
// shared/agent/intent.ts — the Level-1 (deterministic) intent classifier.
import { describe, it, expect } from 'vitest';
import {
  classifyIntent, coerceIntent, negativeConstraintBlock, type IntentResult,
} from '../../shared/agent/intent';

const ALL_ON = { connectorsOn: ['shamela', 'tafsir', 'lexicon', 'hadith', 'dorar', 'rijal', 'ganjoor', 'urdu-prosody', 'web', 'repositories'] };

describe('classifyIntent — direct (no tools)', () => {
  for (const ask of [
    'اس پیراگراف کی املا ٹھیک کر دو',
    'rewrite this sentence to be clearer',
    'translate this paragraph into Urdu',
    'اس باب کا خلاصہ لکھ دو',
    'fix the spelling and tidy up the formatting',
  ]) {
    it(`"${ask}" → direct`, () => {
      expect(classifyIntent(ask, ALL_ON).route.kind).toBe('direct');
    });
  }

  it('a rewrite that ALSO asks for a citation is NOT direct', () => {
    const r = classifyIntent('اس جملے کو دوبارہ لکھو اور حوالہ بھی دو', ALL_ON);
    expect(r.route.kind).not.toBe('direct');
  });
});

describe('classifyIntent — gated (one connector)', () => {
  it('a Qur\'anic/lexical ask gates to tafsir', () => {
    const r = classifyIntent('قرآن مجید میں لفظ "نية" کے مادے کے وقوعات بتائیں', ALL_ON);
    expect(r.route).toEqual({ kind: 'gated', connectors: ['tafsir'] });
  });

  it('a hadith/isnad ask gates to hadith', () => {
    const r = classifyIntent('اس حدیث کی سند اور رواة بتائیں', ALL_ON);
    expect(r.route).toEqual({ kind: 'gated', connectors: ['hadith'] });
  });

  it('a grading / authenticity ask gates to dorar (not the general hadith connector)', () => {
    const r = classifyIntent('کیا یہ حدیث صحیح ہے یا ضعیف؟', ALL_ON);
    expect(r.route).toEqual({ kind: 'gated', connectors: ['dorar'] });
  });

  it('a narrator-biography ask gates to rijal (not the general hadith connector)', () => {
    const r = classifyIntent('راوی شعبہ بن الحجاج کا حال اور اس کی جرح و تعدیل بتائیں', ALL_ON);
    expect(r.route).toEqual({ kind: 'gated', connectors: ['rijal'] });
  });

  it('a "what does this Arabic word mean in Urdu" ask gates to lexicon (not tafsir)', () => {
    const r = classifyIntent('لفظ "سرابيل" کا لغوی معنیٰ اور مادہ بتائیں', ALL_ON);
    expect(r.route).toEqual({ kind: 'gated', connectors: ['lexicon'] });
  });

  it('a Persian-poetry ask gates to ganjoor', () => {
    const r = classifyIntent('حافظ کے اس فارسی شعر کا مطلب بتائیں', ALL_ON);
    expect(r.route).toEqual({ kind: 'gated', connectors: ['ganjoor'] });
  });

  it('a taqṭīʿ / metre ask gates to urdu-prosody', () => {
    const r = classifyIntent('اس شعر کی تقطیع کر کے بحر بتائیں', ALL_ON);
    expect(r.route).toEqual({ kind: 'gated', connectors: ['urdu-prosody'] });
  });

  it('does not gate to a connector that is switched off', () => {
    const r = classifyIntent('اس حدیث کی سند بتائیں', { connectorsOn: ['tafsir'] });
    expect(r.route.kind).toBe('open');
    expect(r.ambiguous).toBe(false);
  });
});

describe('classifyIntent — open / ambiguous', () => {
  it('a fatwa ask (spans several sources) is open + ambiguous', () => {
    const r = classifyIntent('اس مسئلے میں چاروں مذاہب کا فتویٰ کیا ہے؟', ALL_ON);
    expect(r.route.kind).toBe('open');
    expect(r.ambiguous).toBe(true);
  });

  it('a bare topic with no signal is open + ambiguous', () => {
    const r = classifyIntent('اجتہاد', ALL_ON);
    expect(r.route.kind).toBe('open');
    expect(r.ambiguous).toBe(true);
  });

  it('an ask touching both tafsir and hadith is ambiguous', () => {
    const r = classifyIntent('اس آیت اور اس سے متعلق حدیث دونوں بتائیں', ALL_ON);
    expect(r.route.kind).toBe('open');
    expect(r.ambiguous).toBe(true);
  });
});

describe('coerceIntent — the LLM trust boundary', () => {
  const heuristic: IntentResult = { route: { kind: 'open' }, ambiguous: true, matchedDomains: ['tafsir', 'hadith'] };
  const known = ['tafsir', 'hadith', 'shamela'];

  it('accepts a valid gated verdict', () => {
    const r = coerceIntent({ route: 'gated', connectors: ['tafsir'] }, heuristic, known);
    expect(r.route).toEqual({ kind: 'gated', connectors: ['tafsir'] });
  });

  it('drops unknown connector ids and falls back when none survive', () => {
    const r = coerceIntent({ route: 'gated', connectors: ['made-up'] }, heuristic, known);
    expect(r.route.kind).toBe('open');
    expect(r.degraded).toBe(true);
  });

  it('malformed JSON → the heuristic, flagged degraded', () => {
    const r = coerceIntent('not an object', heuristic, known);
    expect(r.route).toEqual(heuristic.route);
    expect(r.degraded).toBe(true);
  });

  it('an unrecognised route string falls back to the heuristic kind', () => {
    const r = coerceIntent({ route: 'weird' }, heuristic, known);
    expect(r.route.kind).toBe('open');
  });
});

describe('negativeConstraintBlock', () => {
  it('direct forbids every source connector', () => {
    expect(negativeConstraintBlock({ kind: 'direct' })).toMatch(/do not call any research or source connector/i);
  });

  it('gated→tafsir names tafsir and forbids hadith', () => {
    const s = negativeConstraintBlock({ kind: 'gated', connectors: ['tafsir'] });
    expect(s).toMatch(/query_tafseer/);
    expect(s).toMatch(/do not call the hadith connector/i);
  });

  it('every gateable connector has tailored guidance (not the generic fallback)', () => {
    for (const c of ['tafsir', 'hadith', 'dorar', 'rijal', 'lexicon', 'ganjoor', 'urdu-prosody', 'repositories']) {
      const s = negativeConstraintBlock({ kind: 'gated', connectors: [c] });
      expect(s, c).not.toMatch(/^Stay within the/);
      expect(s.length, c).toBeGreaterThan(40);
    }
  });

  it('gated→dorar steers to grade_hadith and away from tafsir', () => {
    const s = negativeConstraintBlock({ kind: 'gated', connectors: ['dorar'] });
    expect(s).toMatch(/grade_hadith/);
    expect(s).toMatch(/query_tafseer/);
  });

  it('open adds nothing', () => {
    expect(negativeConstraintBlock({ kind: 'open' })).toBe('');
  });
});
