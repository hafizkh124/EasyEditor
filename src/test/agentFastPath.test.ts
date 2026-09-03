// @vitest-environment node
// shared/agent/fastPath.ts (M9 ADR-0027 F1). A pure linguistic/editing ask on
// one identifiable chapter skips the loop and maps to a single run_task. An ask
// that also wants research/citations, or names no chapter, must fall through.
import { describe, it, expect } from 'vitest';
import { detectFastPath } from '../../shared/agent/fastPath';

const ctx = { chapters: ['01-intro.docx'] };

describe('detectFastPath', () => {
  it('routes a bare اعراب request on the one chapter', () => {
    expect(detectFastPath('اس فائل پر اعراب لگا دو', ctx)).toEqual({ kind: 'run_task', task: 'harakat', chapter: '01-intro.docx' });
  });

  it('routes a spelling fix that names the chapter', () => {
    const r = detectFastPath('fix the spelling in 01-intro.docx', ctx);
    expect(r?.task).toBe('spelling');
    expect(r?.chapter).toBe('01-intro.docx');
  });

  it('falls through when the ask also wants citations / research', () => {
    expect(detectFastPath('summarise this chapter and add citations', ctx)).toBeNull();
    expect(detectFastPath('اس باب کا خلاصہ کرو اور تخریج کرو', ctx)).toBeNull();
  });

  it('falls through when no chapter can be identified and there are several', () => {
    expect(detectFastPath('fix the spelling', { chapters: ['a.docx', 'b.docx'] })).toBeNull();
  });

  it('falls through for a multi-clause instruction', () => {
    expect(detectFastPath('harakat this. then reformat it. also shorten the intro.', ctx)).toBeNull();
  });

  it('falls through for a non-editing question', () => {
    expect(detectFastPath('what does this chapter argue?', ctx)).toBeNull();
  });
});
