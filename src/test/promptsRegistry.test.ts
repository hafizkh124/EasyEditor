import { describe, it, expect } from 'vitest';
import { SCHOLARLY_PROMPTS } from '../lib/prompts/promptsRegistry';
import { pickPromptKey } from '../lib/prompts/index';

/**
 * The eight classical prompts whose `corpusReady` is held `false` until the
 * DEPLOYED path is verified per prompt (supabase/deploy/README.md, "Classical
 * prompts: evidence gate"). Flipping one is a deliberate act: change it here
 * AND record the check in the README table, or this test will say so.
 */
const AWAITING_LIVE_VERIFICATION = [
  'study_masala',
  'compare_madhahib',
  'tafsir_aya_muqaran',
  'nazila_muasira',
  'takhrij_fatwa',
  'lughat_w_irab',
  'tarjama_rawi',
  'seerat_alam',
];

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

      for (const arg of prompt.arguments) {
        expect(arg.name).toBeTruthy();
        expect(arg.labelUr).toBeTruthy();
        expect(typeof arg.required).toBe('boolean');
      }
    }
  });

  it('holds the eight classical prompts at corpusReady:false until each is verified live', () => {
    // A green badge tells a scholar the citations are corpus-backed. Turath
    // being integrated does not establish that for a given prompt: the planner
    // must route to it and the answer must carry relevant, working citations.
    const notReady = SCHOLARLY_PROMPTS.filter((p) => !p.corpusReady).map((p) => p.id).sort();
    expect(notReady).toEqual([...AWAITING_LIVE_VERIFICATION].sort());
  });

  it('keeps every prompt that does not depend on a classical corpus corpusReady:true', () => {
    for (const p of SCHOLARLY_PROMPTS) {
      if (AWAITING_LIVE_VERIFICATION.includes(p.id)) continue;
      expect(p.corpusReady, `Prompt ${p.id} should be corpusReady`).toBe(true);
    }
  });

  it('only ever holds back a prompt that is grounded (an ungrounded aid has no corpus to wait for)', () => {
    for (const p of SCHOLARLY_PROMPTS) {
      if (!p.corpusReady) expect(p.grounded, `${p.id} is unready but not grounded`).toBe(true);
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
      'seerat_alam',
    ];

    const expectedAuthoringUngrounded = ['khittat_bahth', 'kitabat_maqal', 'tahqeeq_texts', 'tabsira_kitab'];

    const groundedIds = SCHOLARLY_PROMPTS.filter((p) => p.grounded).map((p) => p.id);
    const ungroundedIds = SCHOLARLY_PROMPTS.filter((p) => !p.grounded).map((p) => p.id);

    expect(groundedIds.sort()).toEqual(expectedGrounded.sort());
    expect(ungroundedIds.sort()).toEqual(expectedAuthoringUngrounded.sort());
  });

  it('systemInstructionTemplate contains template tokens for required arguments', () => {
    for (const prompt of SCHOLARLY_PROMPTS) {
      const requiredArgs = prompt.arguments.filter((a) => a.required);
      for (const reqArg of requiredArgs) {
        expect(
          prompt.systemInstructionTemplate,
          `Prompt ${prompt.id} template must contain {{${reqArg.name}}}`,
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
