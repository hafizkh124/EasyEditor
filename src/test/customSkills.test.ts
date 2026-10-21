// @vitest-environment node
// Custom skills: skill.md import/export (shared/playbooks/parseSkillMarkdown.ts),
// the `extra` registry layer with the "disabled built-in yields its trigger"
// override rule, and the temporary starter skills added to the registry.
import { describe, it, expect } from 'vitest';
import { PLAYBOOKS, selectPlaybook, resolvePlaybook, getPlaybook, mergeSkillState } from '../../shared/playbooks/registry';
import { validatePlaybook } from '../../shared/playbooks/executor';
import { parseSkillMarkdown, serializeSkillMarkdown, buildCustomSkill } from '../../shared/playbooks/parseSkillMarkdown';

const SAMPLE = `---
title: My detailed takhrij
trigger: takhrij
keywords: takhrij, تخريج
steps: search_hadith, grade_hadith
---
Never grade a hadith yourself.
`;

describe('temporary starter skills', () => {
  it('/takhrij and /fatwa resolve to the new built-ins', () => {
    expect(resolvePlaybook('/takhrij')?.id).toBe('hadith-takhreej');
    expect(resolvePlaybook('fatwa')?.id).toBe('fatwa-writing');
    expect(selectPlaybook('/ayah-sources')?.id).toBe('quran-verse-sources');
  });

  it('the takhrij guidance forbids self-grading and carries the not-found disclaimer', () => {
    const g = getPlaybook('hadith-takhreej')!.guidance!;
    expect(g).toContain('لم أقف عليه في المصادر المتاحة');
    expect(g).toMatch(/never grade a hadith yourself/i);
  });

  it('the new skills do not steal the existing fatwa / takhreej keyword matches', () => {
    expect(selectPlaybook('اس مسئلہ پر فتویٰ درکار ہے')?.id).toBe('shariah-fatwa');
    expect(selectPlaybook('اس کچے مسودے کی تخریج کر دو')?.id).toBe('manuscript-takhreej');
  });
});

describe('parseSkillMarkdown / serializeSkillMarkdown', () => {
  it('parses front matter + body into a valid custom playbook', () => {
    const r = parseSkillMarkdown(SAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skill.id).toBe('custom-takhrij');
    expect(r.skill.trigger).toBe('takhrij');
    expect(r.skill.keywords).toEqual(['takhrij', 'تخريج']);
    expect(r.skill.guidance).toBe('Never grade a hadith yourself.');
    expect(r.skill.steps.map((s) => s.tool)).toEqual(['search_hadith', 'grade_hadith']);
    expect(validatePlaybook(r.skill)).toEqual([]);
  });

  it('round-trips export → import', () => {
    const first = parseSkillMarkdown(SAMPLE);
    if (!first.ok) throw new Error('sample must parse');
    const again = parseSkillMarkdown(serializeSkillMarkdown(first.skill));
    expect(again).toEqual(first);
  });

  it('rejects unknown tools, missing steps, bad triggers and missing front matter', () => {
    const bad = (t: string) => {
      const r = parseSkillMarkdown(t);
      return r.ok ? [] : r.errors.join(' | ');
    };
    expect(bad(SAMPLE.replace('search_hadith', 'rm_rf'))).toMatch(/unknown tool "rm_rf"/);
    expect(bad('---\ntitle: x\n---\nbody')).toMatch(/at least one step/);
    expect(bad(SAMPLE.replace('trigger: takhrij', 'trigger: has space'))).toMatch(/trigger may only/);
    expect(bad('no front matter')).toMatch(/front matter/);
  });

  it('buildCustomSkill always prefixes the id with custom-', () => {
    const r = buildCustomSkill({ title: 'Anything', steps: ['search_hadith'] });
    expect(r.ok && r.skill.id.startsWith('custom-')).toBe(true);
  });
});

describe('registry `extra` (custom skills)', () => {
  const custom = (() => {
    const r = parseSkillMarkdown(SAMPLE);
    if (!r.ok) throw new Error('sample must parse');
    return [r.skill];
  })();
  const allOn = mergeSkillState({}, {}, custom);

  it('mergeSkillState covers custom skills too', () => {
    expect(allOn['custom-takhrij']).toBe(true);
    expect(Object.keys(allOn)).toHaveLength(PLAYBOOKS.length + 1);
  });

  it('a custom skill with a unique trigger resolves, and by id', () => {
    const unique = parseSkillMarkdown(SAMPLE.replace('trigger: takhrij', 'trigger: mine'));
    if (!unique.ok) throw new Error('parse');
    expect(resolvePlaybook('/mine', allOn, [unique.skill])?.id).toBe(unique.skill.id);
    expect(getPlaybook(unique.skill.id, [unique.skill])).toBeDefined();
    expect(selectPlaybook('/mine now', allOn, [unique.skill])?.id).toBe(unique.skill.id);
  });

  it('a built-in trigger wins over a custom skill with the same trigger', () => {
    expect(resolvePlaybook('/takhrij', allOn, custom)?.id).toBe('hadith-takhreej');
    expect(selectPlaybook('/takhrij', allOn, custom)?.id).toBe('hadith-takhreej');
  });

  it('once the built-in is switched off, its trigger yields to the custom skill', () => {
    const off = { ...allOn, 'hadith-takhreej': false };
    expect(resolvePlaybook('/takhrij', off, custom)?.id).toBe('custom-takhrij');
    expect(selectPlaybook('/takhrij', off, custom)?.id).toBe('custom-takhrij');
    // and with no custom skill, off still means off
    expect(resolvePlaybook('/takhrij', off)).toBeUndefined();
  });

  it('a switched-off custom skill disappears from keyword matching', () => {
    const off = { ...allOn, 'custom-takhrij': false, 'hadith-takhreej': false };
    expect(selectPlaybook('تخريج', off, custom)?.id).not.toBe('custom-takhrij');
  });
});
