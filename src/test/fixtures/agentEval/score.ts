/**
 * M9 Phase B — scoring for the live-model eval (pure; unit-tested in
 * agentEvalScore.test.ts without a live model).
 *
 * A scenario declares what a competent run must do — call certain tools, avoid
 * others, land a footnote, finish inside a step budget. `scoreScenario` turns a
 * finished run into a pass/fail plus the metrics that matter when comparing one
 * model (or provider) against another.
 */
import type { AgentRunResult } from '../../../../shared/agent/types.js';
import type { DispatchCall } from './world.js';

export interface EvalExpectations {
  /** Each inner array is an OR-group; every group must have ≥ 1 tool called. */
  expectAnyTool?: string[][];
  /** Tools that must NOT be called at all. */
  forbidTools?: string[];
  /** Minimum successful insert_footnote calls. */
  minFootnotes?: number;
  /** Maximum successful insert_footnote calls — 0 means "nothing was citable, so cite nothing". */
  maxFootnotes?: number;
  /** The run must end cleanly (loop: stopReason 'done'; playbook: not 'error'). */
  mustComplete?: boolean;
  /** Upper bound on model turns. */
  maxSteps?: number;
  /** search_general must never be followed by a footnote citing its output (it has no id in the ledger — so this is really "did the model try"). */
  noGeneralCitation?: boolean;
}

export interface EvalScenarioLike {
  id: string;
  kind: 'loop' | 'playbook';
  expect: EvalExpectations;
}

export interface ScenarioMetrics {
  steps: number;
  toolCalls: number;
  footnotesAttempted: number;
  footnotesInserted: number;
  /** inserted / attempted, or 1 when none were attempted. */
  citationResolveRate: number;
  /** insert_footnote calls that failed the ledger gate (invented id). */
  groundingViolations: number;
  usedGeneral: boolean;
}

export interface ScenarioScore {
  id: string;
  kind: 'loop' | 'playbook';
  pass: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
  metrics: ScenarioMetrics;
}

export function computeMetrics(result: AgentRunResult, calls: DispatchCall[]): ScenarioMetrics {
  const footnoteCalls = calls.filter((c) => c.name === 'insert_footnote');
  const inserted = footnoteCalls.filter((c) => !c.errored).length;
  const violations = footnoteCalls.filter(
    (c) => c.errored && /not one of|nothing has been retrieved|source_id is required/.test(String((c.result as { error?: unknown })?.error ?? '')),
  ).length;
  return {
    steps: result.steps,
    toolCalls: calls.length,
    footnotesAttempted: footnoteCalls.length,
    footnotesInserted: inserted,
    citationResolveRate: footnoteCalls.length === 0 ? 1 : inserted / footnoteCalls.length,
    groundingViolations: violations,
    usedGeneral: calls.some((c) => c.name === 'search_general'),
  };
}

export function scoreScenario(
  scenario: EvalScenarioLike,
  result: AgentRunResult,
  calls: DispatchCall[],
): ScenarioScore {
  const e = scenario.expect;
  const names = calls.map((c) => c.name);
  const checks: ScenarioScore['checks'] = [];

  if (e.mustComplete) {
    const ok = scenario.kind === 'loop' ? result.stopReason === 'done' : result.stopReason !== 'error';
    checks.push({ name: 'completes', pass: ok, detail: `stopReason=${result.stopReason}` });
  }

  for (const group of e.expectAnyTool ?? []) {
    const ok = group.some((t) => names.includes(t));
    checks.push({ name: `calls one of [${group.join(', ')}]`, pass: ok });
  }

  for (const t of e.forbidTools ?? []) {
    checks.push({ name: `never calls ${t}`, pass: !names.includes(t) });
  }

  const metrics = computeMetrics(result, calls);

  if (typeof e.minFootnotes === 'number') {
    checks.push({
      name: `inserts ≥ ${e.minFootnotes} footnote(s)`,
      pass: metrics.footnotesInserted >= e.minFootnotes,
      detail: `${metrics.footnotesInserted} inserted / ${metrics.footnotesAttempted} attempted`,
    });
  }

  if (typeof e.maxFootnotes === 'number') {
    checks.push({
      name: `inserts ≤ ${e.maxFootnotes} footnote(s)`,
      pass: metrics.footnotesInserted <= e.maxFootnotes,
      detail: `${metrics.footnotesInserted} inserted`,
    });
  }

  if (typeof e.maxSteps === 'number') {
    checks.push({ name: `≤ ${e.maxSteps} steps`, pass: metrics.steps <= e.maxSteps, detail: `${metrics.steps} steps` });
  }

  checks.push({ name: 'no grounding violation', pass: metrics.groundingViolations === 0, detail: `${metrics.groundingViolations}` });

  return { id: scenario.id, kind: scenario.kind, pass: checks.every((c) => c.pass), checks, metrics };
}

export interface EvalSummary {
  total: number;
  passed: number;
  passRate: number;
  meanSteps: number;
  citationResolveRate: number;
  groundingViolations: number;
}

export function summarise(scores: ScenarioScore[]): EvalSummary {
  const total = scores.length;
  const passed = scores.filter((s) => s.pass).length;
  const withFootnotes = scores.filter((s) => s.metrics.footnotesAttempted > 0);
  return {
    total,
    passed,
    passRate: total ? passed / total : 0,
    meanSteps: total ? scores.reduce((n, s) => n + s.metrics.steps, 0) / total : 0,
    citationResolveRate: withFootnotes.length
      ? withFootnotes.reduce((n, s) => n + s.metrics.citationResolveRate, 0) / withFootnotes.length
      : 1,
    groundingViolations: scores.reduce((n, s) => n + s.metrics.groundingViolations, 0),
  };
}

export interface EvalBaseline {
  minPassRate: number;
  minCitationResolveRate: number;
  maxGroundingViolations: number;
  maxMeanSteps: number;
}

/** Returns the list of baseline breaches (empty ⇒ the run meets the bar). */
export function checkBaseline(summary: EvalSummary, baseline: EvalBaseline): string[] {
  const fails: string[] = [];
  if (summary.passRate < baseline.minPassRate) {
    fails.push(`passRate ${summary.passRate.toFixed(2)} < ${baseline.minPassRate}`);
  }
  if (summary.citationResolveRate < baseline.minCitationResolveRate) {
    fails.push(`citationResolveRate ${summary.citationResolveRate.toFixed(2)} < ${baseline.minCitationResolveRate}`);
  }
  if (summary.groundingViolations > baseline.maxGroundingViolations) {
    fails.push(`groundingViolations ${summary.groundingViolations} > ${baseline.maxGroundingViolations}`);
  }
  if (summary.meanSteps > baseline.maxMeanSteps) {
    fails.push(`meanSteps ${summary.meanSteps.toFixed(1)} > ${baseline.maxMeanSteps}`);
  }
  return fails;
}
