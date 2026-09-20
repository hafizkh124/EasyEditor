import { describe, it, expect } from 'vitest';
import { SCHOLARLY_PROMPTS, ScholarlyPromptDef } from '../lib/prompts/promptsRegistry';
import { pickPromptKey } from '../lib/prompts/index';

describe('SCHOLARLY_PROMPTS Registry', () => {
  it('contains exactly 14 specialized scholarly prompts', () => {
    expect(SCHOLARLY_PROMPTS).toHaveLength(14);
  });

  it('each prompt has required metadata fields and non-empty strings', () => {
    const validCategories = ['fiqh', 'hadith', 'tafsir', 'general', 'authoring', 'lexicon'];

    for (const prompt of SCHOLARLY_PROMPTS) {
      expect(prompt.id).toBeTruthy();
      expect(prompt.code).toBe(prompt.id);
      expect(prompt.titleAr.trim().length).toBeGreaterThan(0);
      expect(prompt.titleUr.trim().length).toBeGreaterThan(0);
      expect(prompt.descriptionUr.trim().length).toBeGreaterThan(0);
      expect(validCategories).toContain(prompt.category);
      expect(prompt.systemInstructionTemplate.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(prompt.arguments)).toBe(true);
      expect(prompt.arguments.length).toBeGreaterThan(0);

      // Verify arguments structure
      for (const arg of prompt.arguments) {
        expect(arg.name).toBeTruthy();
        expect(arg.labelUr).toBeTruthy();
        expect(typeof arg.required).toBe('boolean');
      }
    }
  });

  it('all 14 prompts are corpusReady: true (now backed by Turath.io & ingested collections)', () => {
    for (const prompt of SCHOLARLY_PROMPTS) {
      expect(prompt.corpusReady, `Prompt ${prompt.id} should be corpusReady`).toBe(true);
    }
  });

  it('correctly partitions grounded vs ungrounded prompts', () => {
    const expectedGrounded = [
      'study_masala',
      'compare_madhahib',
      'trace_hadith',
      'tafsir_aya_muqaran',
      'nazila_muasira',
      'tarjama_muqaran',
      'takhrij_fatwa',
      'lughat_w_irab',
      'tarjama_rawi',
      'seerat_alam'
    ];

    const expectedAuthoringUngrounded = [
      'khittat_bahth',
      'kitabat_maqal',
      'tahqeeq_texts',
      'tabsira_kitab'
    ];

    const groundedIds = SCHOLARLY_PROMPTS.filter(p => p.grounded).map(p => p.id);
    const ungroundedIds = SCHOLARLY_PROMPTS.filter(p => !p.grounded).map(p => p.id);

    expect(groundedIds.sort()).toEqual(expectedGrounded.sort());
    expect(ungroundedIds.sort()).toEqual(expectedAuthoringUngrounded.sort());
  });

  it('systemInstructionTemplate contains template tokens for required arguments', () => {
    for (const prompt of SCHOLARLY_PROMPTS) {
      const requiredArgs = prompt.arguments.filter(a => a.required);
      for (const reqArg of requiredArgs) {
        expect(
          prompt.systemInstructionTemplate,
          `Prompt ${prompt.id} template must contain {{${reqArg.name}}}`
        ).toContain(`{{${reqArg.name}}}`);
      }
    }
  });
});

describe('pickPromptKey helper', () => {
  it('picks correct system prompt key based on active assist modes', () => {
    expect(pickPromptKey([])).toBe('normal');
    expect(pickPromptKey(['spelling'])).toBe('spelling');
    expect(pickPromptKey(['citations'])).toBe('citations');
    expect(pickPromptKey(['spelling', 'citations'])).toBe('combined');
    expect(pickPromptKey(['citations', 'spelling'])).toBe('combined');
  });
});
