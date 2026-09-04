// @vitest-environment node
// shared/ai/prompts/indexEntries.ts (M9 Phase 6). build_scholarly_indexes runs
// ONE fixed extraction instruction keyed by a closed `kinds` set — never a
// caller prompt — and parses the model's JSON into { find, entry } pairs.
import { describe, it, expect } from 'vitest';
import { buildIndexExtractionInstruction, parseIndexEntries, INDEX_KINDS } from '../../shared/ai/prompts/indexEntries';

describe('buildIndexExtractionInstruction', () => {
  it('includes a rule for each requested kind and nothing else', () => {
    const inst = buildIndexExtractionInstruction(['quran', 'names']);
    expect(inst).toMatch(/- quran:/);
    expect(inst).toMatch(/- names:/);
    expect(inst).not.toMatch(/- hadith:/);
    expect(inst).not.toMatch(/- places:/);
  });

  it('demands verbatim locators and a bare JSON array', () => {
    const inst = buildIndexExtractionInstruction([...INDEX_KINDS]);
    expect(inst).toMatch(/occurs verbatim/i);
    expect(inst).toMatch(/JSON array/);
    expect(inst).toMatch(/no markdown fences/i);
  });
});

describe('parseIndexEntries', () => {
  it('parses a clean array', () => {
    expect(parseIndexEntries('[{"find":"قال الغزالي","entry":"الغزالي، أبو حامد"}]'))
      .toEqual([{ find: 'قال الغزالي', entry: 'الغزالي، أبو حامد' }]);
  });

  it('tolerates a markdown fence and surrounding prose', () => {
    const raw = 'Here are the entries:\n```json\n[{"find":"مكة","entry":"مكة المكرمة"}]\n```\nDone.';
    expect(parseIndexEntries(raw)).toEqual([{ find: 'مكة', entry: 'مكة المكرمة' }]);
  });

  it('drops entries missing a field, or with an over-long locator, and returns [] on garbage', () => {
    expect(parseIndexEntries('[{"find":"x"},{"entry":"y"},{"find":"' + 'z'.repeat(200) + '","entry":"Z"}]')).toEqual([]);
    expect(parseIndexEntries('not json at all')).toEqual([]);
    expect(parseIndexEntries('[]')).toEqual([]);
  });
});
