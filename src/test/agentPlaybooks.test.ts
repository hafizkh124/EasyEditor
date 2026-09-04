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

  it('matches the M9 Phase 4 citation/tahqiq playbooks', () => {
    expect(selectPlaybook('/manuscript-takhreej')?.id).toBe('manuscript-takhreej');
    expect(selectPlaybook('اس کچے مسودے کی تخریج کر دو')?.id).toBe('manuscript-takhreej');
    expect(selectPlaybook('/hadith-takhreej-advanced')?.id).toBe('hadith-takhreej-advanced');
    expect(selectPlaybook('اس حدیث کی سند کا دراسۃ الاسانید کرو')?.id).toBe('hadith-takhreej-advanced');
    expect(selectPlaybook('review my chapter like a supervisor audit')?.id).toBe('supervisor-audit');
    expect(selectPlaybook('میرے باب کی تنقیدی نظرثانی کریں')?.id).toBe('supervisor-audit');
  });

  it('matches the M9 Phase 5 authoring playbooks', () => {
    expect(selectPlaybook('/audio-to-chapter')?.id).toBe('audio-to-chapter');
    expect(selectPlaybook('اس آڈیو درس سے باب بنا دو')?.id).toBe('audio-to-chapter');
    expect(selectPlaybook('/thematic-paper')?.id).toBe('thematic-paper');
    expect(selectPlaybook('/analytical-column')?.id).toBe('analytical-column');
    expect(selectPlaybook('اس باب کا اکیڈمک ترجمہ کرو')?.id).toBe('academic-translation');
  });

  it('matches the M9 Phase 6 manuscript playbooks', () => {
    expect(selectPlaybook('/manuscript-edition')?.id).toBe('manuscript-edition');
    expect(selectPlaybook('اس مخطوطہ کی تحقیق اور فروق النسخ')?.id).toBe('manuscript-edition');
    expect(selectPlaybook('/generate-indexes')?.id).toBe('generate-indexes');
    expect(selectPlaybook('اس باب کی فہارس بنا دو')?.id).toBe('generate-indexes');
  });

  it('audio-to-chapter never pastes the transcript through a tool call — it seeds via from_source', () => {
    const pb = getPlaybook('audio-to-chapter')!;
    const create = pb.steps.find((s) => s.tool === 'create_chapter')!;
    expect(create.bind).toContain('from_source');
    expect(create.bind).not.toContain('html');
  });

  it('supervisor-audit never carries a text-editing tool (it only reads + comments)', () => {
    const pb = getPlaybook('supervisor-audit')!;
    const editors = new Set(['run_task', 'draft_section', 'insert_footnote', 'set_page_layout', 'convert_document']);
    expect(pb.steps.some((s) => editors.has(s.tool))).toBe(false);
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
