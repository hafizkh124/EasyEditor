// @vitest-environment node
// shared/agent/toolScoping.ts (M9 ADR-0027 F2). The model is never shown the
// whole registry: pruning narrows by playbook or by keyword domain. Two
// invariants must survive that: the FLOOR tools are always present, and if a
// citable search tool is exposed in a write mode then insert_footnote is too.
import { describe, it, expect } from 'vitest';
import { toolsFor, FLOOR_TOOLS } from '../../shared/agent/toolScoping';
import { PLAYBOOKS } from '../../shared/playbooks/registry';

const names = (mode: Parameters<typeof toolsFor>[0], ctx?: Parameters<typeof toolsFor>[1]) =>
  toolsFor(mode, ctx).map((t) => t.name);

describe('toolsFor', () => {
  it('a tafsir/āyah ask never exposes hadith-only or manuscript tools', () => {
    const n = names('auto', { ask: 'اس آیت کی تفسیر بیان کریں' });
    expect(n).not.toContain('add_document_comment');
    expect(n).toContain('search_corpus');
  });

  it('always includes the FLOOR tools, whatever the ask', () => {
    for (const ask of ['تفسیر', 'حدیث کی سند', 'install a nastaliq font', 'random unrelated question']) {
      const n = names('auto', { ask });
      for (const f of FLOOR_TOOLS) expect(n, ask).toContain(f);
    }
  });

  it('citation closure — exposing a citable search tool in a write mode also exposes insert_footnote', () => {
    const n = names('auto', { ask: 'اس حدیث کی تخریج کریں اور حوالہ دیں' });
    if (n.includes('search_shamela') || n.includes('search_corpus')) {
      expect(n).toContain('insert_footnote');
    }
  });

  it('a playbook run is scoped to its own steps plus the floor + run_playbook', () => {
    const pb = PLAYBOOKS.find((p) => p.id === 'add-verified-citations')!;
    const n = names('auto', { playbook: pb });
    const stepTools = new Set(pb.steps.map((s) => s.tool));
    for (const t of n) {
      const ok = stepTools.has(t) || (FLOOR_TOOLS as readonly string[]).includes(t)
        || t === 'run_playbook' || t === 'insert_footnote' || t === 'ask_clarifying_question';
      expect(ok, `unexpected tool in scoped set: ${t}`).toBe(true);
    }
  });

  it('Ask mode never yields a write tool even after scoping', () => {
    const n = toolsFor('ask', { ask: 'اس حدیث کی تخریج' });
    expect(n.every((t) => t.effect === 'read')).toBe(true);
  });

  it('an ask with no domain keyword returns the full mode set (+ clarify)', () => {
    const full = names('auto');
    const generic = names('auto', { ask: 'please help me with my chapter' });
    expect(generic.length).toBeGreaterThanOrEqual(full.length);
  });
});
