// @vitest-environment node
// shared/playbooks/executor.ts (M9 ADR-0020). The executor owns control flow:
// it validates a playbook against the closed registry, seeds args from context,
// and marks which args still need a scoped bind call. The model never chooses
// which step runs or in what order.
import { describe, it, expect } from 'vitest';
import { validatePlaybook, planPlaybook } from '../../shared/playbooks/executor';
import { PLAYBOOKS, type Playbook } from '../../shared/playbooks/registry';

describe('validatePlaybook', () => {
  it('accepts every shipped playbook', () => {
    for (const pb of PLAYBOOKS) {
      expect(validatePlaybook(pb), `${pb.id}`).toEqual([]);
    }
  });

  it('flags an unknown tool', () => {
    const bad: Playbook = { id: 'x', title: 'x', keywords: [], steps: [{ tool: 'delete_everything', note: 'n' }] };
    expect(validatePlaybook(bad).join()).toMatch(/unknown tool/);
  });

  it('flags a seeded arg that is not a parameter of the tool', () => {
    const bad: Playbook = { id: 'x', title: 'x', keywords: [], steps: [{ tool: 'read_document', args: { nope: 1 }, bind: ['chapter'], note: 'n' }] };
    expect(validatePlaybook(bad).join()).toMatch(/not a parameter/);
  });

  it('flags a required arg that is neither seeded nor bound', () => {
    const bad: Playbook = { id: 'x', title: 'x', keywords: [], steps: [{ tool: 'search_corpus', note: 'n' }] };
    expect(validatePlaybook(bad).join()).toMatch(/required arg "query"/);
  });

  it("catches the M8 'citations' defect shape (a run_task step whose slug dispatch rejects would still validate structurally — but the fixed playbook has no such step)", () => {
    const thesis = PLAYBOOKS.find((p) => p.id === 'thesis-university-format')!;
    const hasCitationsSlug = thesis.steps.some((s) => (s.args as { task?: string } | undefined)?.task === 'citations');
    expect(hasCitationsSlug).toBe(false);
  });
});

describe('planPlaybook', () => {
  it('seeds the chapter from context and drops it from the bind list', () => {
    const pb = PLAYBOOKS.find((p) => p.id === 'add-verified-citations')!;
    const plan = planPlaybook(pb, { chapter: '02-body.docx' });
    const read = plan.steps[0];
    expect(read.args.chapter).toBe('02-body.docx');
    expect(read.bind).not.toContain('chapter');
  });

  it('keeps genuinely unknown args in the bind list for a scoped call', () => {
    const pb = PLAYBOOKS.find((p) => p.id === 'add-verified-citations')!;
    const plan = planPlaybook(pb, { chapter: '02-body.docx' });
    const search = plan.steps.find((s) => s.tool === 'search_corpus')!;
    expect(search.bind).toContain('query');
  });

  it('produces a human-readable summary for Plan-mode approval', () => {
    const pb = PLAYBOOKS.find((p) => p.id === 'section-summaries')!;
    const plan = planPlaybook(pb, {});
    expect(plan.summary).toMatch(/section-summaries|summary/i);
    expect(plan.steps).toHaveLength(pb.steps.length);
  });
});
