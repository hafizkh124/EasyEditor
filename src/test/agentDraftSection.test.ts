// @vitest-environment node
// shared/ai/prompts/draftSection.ts (M9 ADR-0021). draft_section runs ONE of a
// fixed set of instruction templates keyed by mode — the caller never writes a
// prompt. Grounded modes require sources.
import { describe, it, expect } from 'vitest';
import { DRAFT_MODES, DRAFT_MODE_NAMES, getDraftMode, buildDraftInput } from '../../shared/ai/prompts/draftSection';

describe('draft mode registry', () => {
  it('exposes exactly the six named modes', () => {
    expect(DRAFT_MODE_NAMES.sort()).toEqual(['column', 'literary-urdu', 'outline', 'prose', 'summary', 'translation']);
  });

  it('prose / column-with-sources / translation / literary-urdu are grounded; outline / summary are not', () => {
    expect(DRAFT_MODES.prose.grounded).toBe(true);
    expect(DRAFT_MODES.translation.grounded).toBe(true);
    expect(DRAFT_MODES['literary-urdu'].grounded).toBe(true);
    expect(DRAFT_MODES.outline.grounded).toBe(false);
    expect(DRAFT_MODES.summary.grounded).toBe(false);
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
