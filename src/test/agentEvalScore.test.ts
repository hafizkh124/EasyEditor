// @vitest-environment node
// M9 Phase B — the eval scoring logic (pure; runs in CI, no live model).
// Proves scoreScenario / summarise / checkBaseline turn a finished run + the
// scripted-dispatch call log into the right verdicts, so a real eval failure
// is trustworthy.
import { describe, it, expect, vi } from 'vitest';
import type { AgentRunResult, ModelStep } from '../../shared/agent/types';
import type { DispatchCall } from './fixtures/agentEval/world';
import { runAgentLoop } from '../../shared/agent/loop';
import { buildSystemPrompt } from '../../shared/agent/systemPrompt';
import { toolsFor } from '../../shared/agent/toolScoping';
import {
  computeMetrics, scoreScenario, summarise, checkBaseline,
  type EvalScenarioLike,
} from './fixtures/agentEval/score';
import { SCENARIOS } from './fixtures/agentEval/scenarios';
import { makeScriptedDispatch } from './fixtures/agentEval/world';

const runResult = (over: Partial<AgentRunResult> = {}): AgentRunResult => ({
  answer: 'done', messages: [], toolCalls: [], steps: 3, stopReason: 'done', ...over,
});

const call = (name: string, args: Record<string, unknown>, result: unknown): DispatchCall => ({
  name, args, result, errored: typeof result === 'object' && result !== null && 'error' in result,
});

describe('computeMetrics', () => {
  it('counts inserted vs attempted footnotes and the resolve rate', () => {
    const calls = [
      call('search_corpus', { query: 'x' }, { results: [] }),
      call('insert_footnote', { source_id: 'a' }, { applied: 1 }),
      call('insert_footnote', { source_id: 'ghost' }, { error: 'insert_footnote: "ghost" is not one of the 1 chunk id(s) retrieved in this task' }),
    ];
    const m = computeMetrics(runResult({ steps: 5 }), calls);
    expect(m).toMatchObject({ footnotesAttempted: 2, footnotesInserted: 1, groundingViolations: 1, steps: 5 });
    expect(m.citationResolveRate).toBeCloseTo(0.5);
  });

  it('resolve rate is 1 when no footnote was attempted', () => {
    expect(computeMetrics(runResult(), [call('set_page_layout', {}, { ok: true })]).citationResolveRate).toBe(1);
  });

  it('a non-ledger error on insert_footnote is not a grounding violation', () => {
    const calls = [call('insert_footnote', { source_id: 'a', claim: 'c' }, { error: 'the source does not support this claim' })];
    expect(computeMetrics(runResult(), calls).groundingViolations).toBe(0);
  });
});

describe('scoreScenario', () => {
  const base: EvalScenarioLike = { id: 't', kind: 'loop', expect: {} };

  it('passes when every declared expectation holds', () => {
    const sc: EvalScenarioLike = {
      ...base,
      expect: { expectAnyTool: [['search_corpus', 'search_shamela']], minFootnotes: 1, mustComplete: true, maxSteps: 10 },
    };
    const calls = [
      call('search_shamela', { query: 'x' }, { results: [{ id: 's1' }] }),
      call('insert_footnote', { source_id: 's1' }, { applied: 1 }),
    ];
    const score = scoreScenario(sc, runResult({ steps: 4 }), calls);
    expect(score.pass).toBe(true);
  });

  it('fails a forbidden tool, a missing OR-group, an over-budget run, and a grounding violation', () => {
    const sc: EvalScenarioLike = {
      ...base,
      expect: { expectAnyTool: [['search_corpus']], forbidTools: ['search_general'], maxSteps: 2, mustComplete: true },
    };
    const calls = [
      call('search_general', { query: 'x' }, { answer: 'y' }),
      call('insert_footnote', { source_id: 'ghost' }, { error: 'is not one of the 0 chunk id(s) retrieved in this task' }),
    ];
    const score = scoreScenario(sc, runResult({ steps: 9, stopReason: 'step-limit' }), calls);
    expect(score.pass).toBe(false);
    const failed = score.checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining([
      'completes', 'calls one of [search_corpus]', 'never calls search_general', '≤ 2 steps', 'no grounding violation',
    ]));
  });

  it('maxFootnotes 0 enforces "nothing citable → cite nothing"', () => {
    const sc: EvalScenarioLike = { ...base, expect: { maxFootnotes: 0 } };
    const clean = scoreScenario(sc, runResult(), [call('search_corpus', {}, { results: [] })]);
    expect(clean.pass).toBe(true);
    const dirty = scoreScenario(sc, runResult(), [call('insert_footnote', { source_id: 'x' }, { applied: 1 })]);
    expect(dirty.pass).toBe(false);
  });

  it('playbook kind treats any non-error stopReason as complete', () => {
    const sc: EvalScenarioLike = { ...base, kind: 'playbook', expect: { mustComplete: true } };
    expect(scoreScenario(sc, runResult({ stopReason: 'done' }), []).pass).toBe(true);
    expect(scoreScenario(sc, runResult({ stopReason: 'error' }), []).checks.find((c) => c.name === 'completes')!.pass).toBe(false);
  });
});

describe('summarise + checkBaseline', () => {
  const scores = [
    scoreScenario({ id: 'a', kind: 'loop', expect: { minFootnotes: 1 } }, runResult({ steps: 4 }), [call('insert_footnote', { source_id: 's' }, { applied: 1 })]),
    scoreScenario({ id: 'b', kind: 'loop', expect: {} }, runResult({ steps: 8 }), [call('set_page_layout', {}, { ok: true })]),
  ];

  it('aggregates pass rate, mean steps, and the mean citation-resolve rate', () => {
    const s = summarise(scores);
    expect(s).toMatchObject({ total: 2, passed: 2, groundingViolations: 0 });
    expect(s.meanSteps).toBe(6);
    expect(s.citationResolveRate).toBe(1); // only 'a' attempted a footnote, and it resolved
  });

  it('checkBaseline returns the specific breaches', () => {
    const s = summarise(scores);
    expect(checkBaseline(s, { minPassRate: 0.7, minCitationResolveRate: 0.8, maxGroundingViolations: 1, maxMeanSteps: 10 })).toEqual([]);
    const breaches = checkBaseline(s, { minPassRate: 1.1, minCitationResolveRate: 0.8, maxGroundingViolations: 0, maxMeanSteps: 3 });
    expect(breaches).toHaveLength(2); // passRate + meanSteps (violations already 0, resolve fine)
  });
});

describe('the golden set itself', () => {
  it('every scenario is well-formed', () => {
    for (const sc of SCENARIOS) {
      expect(sc.id).toMatch(/^[a-z0-9-]+$/);
      expect(['loop', 'playbook']).toContain(sc.kind);
      if (sc.kind === 'playbook') expect(sc.playbook, sc.id).toBeTruthy();
      expect(Object.keys(sc.world.chapters).length, sc.id).toBeGreaterThan(0);
      expect(sc.instruction.length, sc.id).toBeGreaterThan(10);
    }
  });

  it('scenario ids are unique', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the scripted world feeds the ledger on a retrieval and gates a bad footnote', async () => {
    const { dispatch, ledger } = makeScriptedDispatch(SCENARIOS[0].world);
    await dispatch('search_shamela', { query: 'حديث النية' });
    expect(ledger.size).toBeGreaterThan(0);
    const bad = await dispatch('insert_footnote', { chapter: 'c', marker: '[1]', source_id: 'not-real' }) as { error?: string };
    expect(bad.error).toMatch(/not one of|nothing has been retrieved/);
  });

  it('search_general never enters the ledger', async () => {
    const { dispatch, ledger } = makeScriptedDispatch(SCENARIOS[0].world);
    await dispatch('search_general', { query: 'anything' });
    expect(ledger.size).toBe(0);
  });
});

describe('harness plumbing (scripted model, no network)', () => {
  it('a good run through runAgentLoop + scripted dispatch scores as a pass', async () => {
    const sc = SCENARIOS.find((s) => s.id === 'cite-hadith-loop')!;
    const { dispatch, calls } = makeScriptedDispatch(sc.world);

    // A model that does exactly the right thing: retrieve, then cite, then finish.
    const steps: ModelStep[] = [
      { kind: 'toolCall', name: 'search_shamela', args: { query: 'حديث النية' } },
      { kind: 'toolCall', name: 'insert_footnote', args: { chapter: '01-fiqh.docx', marker: '[1]', source_id: 'shamela:bukhari:1' } },
      { kind: 'text', text: 'حاشیہ لگا دیا گیا۔' },
    ];
    let i = 0;
    const model = vi.fn(async (): Promise<ModelStep> => steps[Math.min(i++, steps.length - 1)]);

    const result = await runAgentLoop(sc.instruction, model, dispatch, buildSystemPrompt({ mode: 'auto', capabilities: { word: true, wordVersion: '16.0', windows: true } }), {
      mode: 'auto',
      tools: toolsFor('auto', { ask: sc.instruction }),
    });

    const score = scoreScenario(sc, result, calls);
    expect(score.pass).toBe(true);
    expect(score.metrics).toMatchObject({ footnotesInserted: 1, groundingViolations: 0 });
  });

  it('an ungrounded run (cite before retrieving) is caught as a grounding violation', async () => {
    const sc = SCENARIOS.find((s) => s.id === 'cite-hadith-loop')!;
    const { dispatch, calls } = makeScriptedDispatch(sc.world);

    const steps: ModelStep[] = [
      { kind: 'toolCall', name: 'insert_footnote', args: { chapter: '01-fiqh.docx', marker: '[1]', source_id: 'made-up-id' } },
      { kind: 'text', text: 'done' },
    ];
    let i = 0;
    const model = vi.fn(async (): Promise<ModelStep> => steps[Math.min(i++, steps.length - 1)]);

    const result = await runAgentLoop(sc.instruction, model, dispatch, 'sys', {
      mode: 'auto', tools: toolsFor('auto', { ask: sc.instruction }),
    });

    const score = scoreScenario(sc, result, calls);
    expect(score.pass).toBe(false);
    expect(score.metrics.groundingViolations).toBe(1);
  });
});
