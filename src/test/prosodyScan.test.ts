// @vitest-environment node
// shared/prosody/scan.ts (ADR-0042) — the rule-based taqṭīʿ engine.
//
// It is a HEURISTIC: Urdu script omits short vowels, so exact scansion of an
// arbitrary line is not achievable from the written form. These tests pin the
// CONTRACT — it always returns, it always labels itself a machine reading, it
// only claims a baḥr on a clean match — not scansion accuracy on hard lines.
import { describe, it, expect } from 'vitest';
import { scanLine, scanProsody, syllabify } from '../../shared/prosody/scan';

describe('scanLine — contract', () => {
  it('every result carries the "machine reading, not a verdict" note', () => {
    for (const s of ['کوئی امید بر نہیں آتی', 'فعولن فعولن', '', 'xyz 123']) {
      expect(scanLine(s).note).toMatch(/machine reading/i);
    }
  });

  it('an empty / whitespace line does not throw and is low-confidence', () => {
    const r = scanLine('   ');
    expect(r.syllables).toEqual([]);
    expect(r.bahr).toBeNull();
    expect(r.confidence).toBe('low');
  });

  it('a non-Arabic string still returns a well-formed result', () => {
    const r = scanLine('hello world 42');
    expect(r.confidence).toBe('low');
    expect(Array.isArray(r.feet)).toBe(true);
  });

  it('names متقارب when fed a clean فعولن×4 pattern (high confidence)', () => {
    const r = scanLine('فعولن فعولن فعولن فعولن');
    expect(r.bahr).toBe('متقارب');
    expect(r.confidence).toBe('high');
    expect(r.feet).toHaveLength(4);
  });

  it('names هزج for a clean مفاعیلن×4 pattern', () => {
    expect(scanLine('مفاعیلن مفاعیلن مفاعیلن مفاعیلن').bahr).toBe('هزج');
  });

  it('does NOT invent a baḥr for an irregular line', () => {
    const r = scanLine('دل ہی تو ہے نہ سنگ و خشت درد سے بھر نہ آئے کیوں');
    // whatever it guesses at the syllable level, an unrecognised pattern must
    // come back as null / low — never a confident wrong answer.
    if (r.bahr !== null) expect(r.confidence).toBe('low');
  });
});

describe('syllabify', () => {
  it('emits only weight 1 or 2', () => {
    for (const w of syllabify('محبت میں نہیں ہے فرق جینے اور مرنے کا').map((s) => s.weight)) {
      expect([1, 2]).toContain(w);
    }
  });
  it('the syllable texts, joined, are non-empty for a real line', () => {
    const s = syllabify('کوئی امید بر نہیں آتی');
    expect(s.length).toBeGreaterThan(3);
  });
});

describe('scanProsody', () => {
  it('splits on newlines and caps at 12 lines', () => {
    const many = Array.from({ length: 20 }, (_v, i) => `مصرع ${i}`).join('\n');
    expect(scanProsody(many).lines.length).toBeLessThanOrEqual(12);
  });
  it('a single line still yields one LineScan', () => {
    expect(scanProsody('فاعلاتن فاعلاتن').lines).toHaveLength(1);
  });
});
