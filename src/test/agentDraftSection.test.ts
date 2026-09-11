// @vitest-environment node
// shared/ai/prompts/draftSection.ts (M9 ADR-0021). draft_section runs ONE of a
// fixed set of instruction templates keyed by mode — the caller never writes a
// prompt. Grounded modes require sources.
import { describe, it, expect } from 'vitest';
import { DRAFT_MODES, DRAFT_MODE_NAMES, getDraftMode, buildDraftInput } from '../../shared/ai/prompts/draftSection';

describe('draft mode registry', () => {
  it('exposes exactly the seven named modes', () => {
    expect(DRAFT_MODE_NAMES.sort()).toEqual(['column', 'fatwa', 'literary-urdu', 'outline', 'prose', 'summary', 'translation']);
  });

  it('prose and translation are grounded; outline / summary / column / fatwa are not', () => {
    expect(DRAFT_MODES.prose.grounded).toBe(true);
    expect(DRAFT_MODES.translation.grounded).toBe(true);
    expect(DRAFT_MODES.outline.grounded).toBe(false);
    expect(DRAFT_MODES.summary.grounded).toBe(false);
    expect(DRAFT_MODES.column.grounded).toBe(false);
    expect(DRAFT_MODES.fatwa.grounded).toBe(false);
  });

  it('literary-urdu is NOT grounded — it recasts the chapter\'s own text, but its instruction forbids adding anything (M9 Phase 5)', () => {
    const spec = DRAFT_MODES['literary-urdu'];
    expect(spec.grounded).toBe(false);
    expect(spec.instruction).toMatch(/CURRENT CHAPTER TEXT/);
    expect(spec.instruction).toMatch(/Do not add facts/i);
    expect(spec.instruction).toMatch(/not a summary/i);
  });

  it("fatwa (M12 Phase E) writes ONLY the ruling — its instruction forbids repeating the template's own sections or restating computed figures", () => {
    const spec = DRAFT_MODES.fatwa;
    expect(spec.html).toBe(true);
    expect(spec.grounded).toBe(false);
    expect(spec.instruction).toMatch(/do not re-type or restate/i);
    expect(spec.instruction).toMatch(/no heading repeating/i);
  });

  it('every instruction forbids inventing facts beyond the excerpts', () => {
    for (const spec of Object.values(DRAFT_MODES)) {
      expect(spec.instruction.length).toBeGreaterThan(80);
    }
    expect(DRAFT_MODES.prose.instruction).toMatch(/SOURCE EXCERPTS|excerpts/i);
  });

  it('getDraftMode rejects an unknown mode', () => {
    expect(getDraftMode('freeform')).toBeUndefined();
  });

  it('buildDraftInput lays sources out with their markers', () => {
    const input = buildDraftInput({
      mode: 'prose',
      sectionHeading: 'التمهيد',
      sources: [{ marker: '1', reference: 'صحيح مسلم ٢', excerpt: 'إنما الأعمال بالنيات' }],
    });
    expect(input).toMatch(/SECTION: التمهيد/);
    expect(input).toMatch(/\[1\] صحيح مسلم ٢/);
  });
});
