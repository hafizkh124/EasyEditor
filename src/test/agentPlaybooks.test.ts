// @vitest-environment node
// shared/playbooks/registry.ts + shared/agent/toolSchemas.ts (SPEC-M8
// Layer 4 / ADR-0016 c1). A playbook is a fixed sequence the agent SELECTS,
// never invents; every step names a tool from the closed registry. Ask mode
// exposes only read tools.
import { describe, it, expect } from 'vitest';
import { PLAYBOOKS, getPlaybook, selectPlaybook, resolvePlaybook } from '../../shared/playbooks/registry';
import { validatePlaybook } from '../../shared/playbooks/executor';
import { AGENT_TOOLS, toolsForMode, getTool } from '../../shared/agent/toolSchemas';

describe('playbook registry', () => {
  it('every playbook step names a real tool from the closed registry', () => {
    const names = new Set(AGENT_TOOLS.map((t) => t.name));
    for (const pb of PLAYBOOKS) {
      for (const step of pb.steps) {
        expect(names.has(step.tool), `${pb.id} → ${step.tool}`).toBe(true);
      }
    }
  });

  it('every playbook passes static validation — steps, seeded args, and bound args all check out (M9 defect #1)', () => {
    for (const pb of PLAYBOOKS) {
      expect(validatePlaybook(pb), `${pb.id}: ${validatePlaybook(pb).join('; ')}`).toEqual([]);
    }
  });

  it('an exact /trigger beats a keyword count', () => {
    expect(selectPlaybook('/add-citations')?.id).toBe('add-verified-citations');
    expect(resolvePlaybook('/section-summaries')?.id).toBe('section-summaries');
    expect(resolvePlaybook('thesis-university-format')?.id).toBe('thesis-university-format');
  });

  it('selectPlaybook matches on keywords, English or Urdu', () => {
    expect(selectPlaybook('please put chapter 2 into university thesis format')?.id).toBe('thesis-university-format');
    expect(selectPlaybook('حواشی اور مراجع درست کریں')?.id).toBe('add-verified-citations');
  });

  it('selectPlaybook returns null when nothing matches — the agent then works step by step', () => {
    expect(selectPlaybook('what time is it')).toBeNull();
  });

  it('matches the P9 playbooks on their keywords (EN + UR)', () => {
    expect(selectPlaybook('make the submission pdf for chapter 3')?.id).toBe('submission-pdf');
    expect(selectPlaybook("apply my supervisor's template")?.id).toBe('apply-supervisor-template');
    expect(selectPlaybook('نستعلیق فونٹ انسٹال کریں')?.id).toBe('install-nastaliq-font');
    expect(selectPlaybook('add section summaries')?.id).toBe('section-summaries');
  });

  it('matches the M9 /shariah-fatwa playbook (EN + UR + AR)', () => {
    expect(selectPlaybook('/shariah-fatwa')?.id).toBe('shariah-fatwa');
    expect(selectPlaybook('اس مسئلہ پر فتویٰ درکار ہے')?.id).toBe('shariah-fatwa');
    expect(selectPlaybook('ما حكم هذه النازلة؟ استفتاء')?.id).toBe('shariah-fatwa');
  });

  it('getPlaybook resolves by id', () => {
    expect(getPlaybook('harmonise-transliteration')?.title).toMatch(/transliteration/i);
    expect(getPlaybook('nope')).toBeUndefined();
  });
});

describe('tool registry', () => {
  it('Ask mode exposes only read-effect tools', () => {
    expect(toolsForMode('ask').every((t) => t.effect === 'read')).toBe(true);
    expect(toolsForMode('auto').length).toBeGreaterThan(toolsForMode('ask').length);
  });

  it('insert_footnote and set_page_layout are write tools; search_* are read', () => {
    expect(getTool('insert_footnote')?.effect).toBe('write');
    expect(getTool('set_page_layout')?.effect).toBe('write');
    expect(getTool('search_corpus')?.effect).toBe('read');
    expect(getTool('list_capabilities')?.effect).toBe('read');
  });

  it('every tool declares required params that exist in its params map', () => {
    for (const t of AGENT_TOOLS) {
      for (const r of t.required) {
        expect(Object.keys(t.params), `${t.name} requires ${r}`).toContain(r);
      }
    }
  });
});
