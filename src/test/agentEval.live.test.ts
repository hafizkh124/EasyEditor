// @vitest-environment node
// M9 Phase B — the LIVE-model quality eval (ADR-0030).
//
// The 27 other agent tests prove the CONTRACT with a scripted ModelFn. This
// one proves the QUALITY of the real model's decisions: does it retrieve
// before it cites, never invent a source, pick the right tool, honour a forced
// (playbook bind) call, and stop when the job is done.
//
// Skipped unless AGENT_EVAL_LIVE=1 AND a key is available (GEMINI_API_KEY, or a
// saved BYOK key). It calls the real Gemini API — it costs tokens and needs a
// network. CI never runs it.
//
//   GEMINI_API_KEY=... AGENT_EVAL_LIVE=1 npx vitest run src/test/agentEval.live.test.ts
//
// To stamp a fresh baseline after a deliberate change:
//   ... AGENT_EVAL_WRITE_BASELINE=1 npx vitest run src/test/agentEval.live.test.ts
//
// In Phase C, point EVAL_MODEL_FN at the candidate provider's ModelFn and run
// the same set — it must meet baseline.json before it becomes selectable.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { runAgentLoop } from '../../shared/agent/loop';
import { buildSystemPrompt } from '../../shared/agent/systemPrompt';
import { toolsFor } from '../../shared/agent/toolScoping';
import { resolvePlaybook } from '../../shared/playbooks/registry';
import { generateWithTools } from '../../electron/agent/geminiTools';
import { runPlaybook } from '../../electron/agent/runPlaybook';
import { makeScriptedDispatch } from './fixtures/agentEval/world';
import { SCENARIOS, type EvalScenario } from './fixtures/agentEval/scenarios';
import {
  scoreScenario, summarise, checkBaseline,
  type ScenarioScore, type EvalBaseline,
} from './fixtures/agentEval/score';

const LIVE = process.env.AGENT_EVAL_LIVE === '1';
const HAS_KEY = Boolean(process.env.GEMINI_API_KEY);
const WRITE_BASELINE = process.env.AGENT_EVAL_WRITE_BASELINE === '1';
const MODEL = process.env.EVAL_MODEL_LABEL ?? 'gemini-2.5-flash';

const BASELINE_PATH = path.resolve(__dirname, 'fixtures/agentEval/baseline.json');
const REPORT_DIR = path.resolve(__dirname, '../../test-results');

/** The real model function under test. Phase C: swap per provider. */
const modelFn = generateWithTools;

const caps = { word: true, wordVersion: '16.0', windows: true } as const;

async function runOneScenario(sc: EvalScenario): Promise<ScenarioScore> {
  const { dispatch, calls } = makeScriptedDispatch(sc.world);
  const systemPrompt = buildSystemPrompt({
    mode: sc.mode,
    capabilities: caps,
    chapters: Object.keys(sc.world.chapters),
  });

  if (sc.kind === 'playbook') {
    const pb = resolvePlaybook(sc.playbook!);
    if (!pb) throw new Error(`scenario ${sc.id}: unknown playbook ${sc.playbook}`);
    const result = await runPlaybook({
      playbook: pb,
      instruction: sc.instruction,
      mode: sc.mode,
      context: { chapter: sc.chapter, instruction: sc.instruction, mentions: {} },
      dispatch,
      systemPrompt,
      fallbackTools: toolsFor(sc.mode, { playbook: pb }),
    });
    return scoreScenario(sc, result, calls);
  }

  const result = await runAgentLoop(sc.instruction, modelFn, dispatch, systemPrompt, {
    mode: sc.mode,
    tools: toolsFor(sc.mode, { ask: sc.instruction }),
    maxSteps: 16,
  });
  return scoreScenario(sc, result, calls);
}

describe.runIf(LIVE && HAS_KEY)('agent live-model eval', () => {
  const scores: ScenarioScore[] = [];

  afterAll(() => {
    if (scores.length === 0) return;
    const summary = summarise(scores);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const report = { model: MODEL, ranAt: new Date().toISOString(), summary, scenarios: scores };
    fs.writeFileSync(path.join(REPORT_DIR, `agent-eval.${MODEL.replace(/[^\w.-]/g, '_')}.json`), JSON.stringify(report, null, 2));

    // eslint-disable-next-line no-console
    console.log(
      `\n── agent eval (${MODEL}) ──\n` +
      scores.map((s) => `  ${s.pass ? '✓' : '✗'} ${s.id}  (${s.metrics.steps} steps, ${s.metrics.footnotesInserted}/${s.metrics.footnotesAttempted} fn)`).join('\n') +
      `\n  passRate ${(summary.passRate * 100).toFixed(0)}%  ·  citationResolve ${(summary.citationResolveRate * 100).toFixed(0)}%  ·  violations ${summary.groundingViolations}  ·  meanSteps ${summary.meanSteps.toFixed(1)}\n`,
    );

    if (WRITE_BASELINE) {
      const next = {
        _note: 'Stamped by AGENT_EVAL_WRITE_BASELINE=1. Tighten thresholds by hand so a genuine regression trips the gate.',
        model: MODEL,
        recordedAt: report.ranAt,
        thresholds: {
          minPassRate: +(summary.passRate - 0.1).toFixed(2),
          minCitationResolveRate: +(summary.citationResolveRate - 0.1).toFixed(2),
          maxGroundingViolations: summary.groundingViolations + 1,
          maxMeanSteps: Math.ceil(summary.meanSteps + 2),
        },
      };
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
    }
  });

  // A playbook scenario can fall through to the free loop (a bind step the model
  // fills wrong) and then run its full step budget of real calls — 3 min covers it.
  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s', async (_id, sc) => {
    const score = await runOneScenario(sc);
    scores.push(score);
    const failed = score.checks.filter((c) => !c.pass);
    expect(failed, `${sc.id} failed: ${failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}`).toEqual([]);
  }, 180_000);

  it('meets the regression baseline', () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as { thresholds: EvalBaseline };
    const breaches = checkBaseline(summarise(scores), baseline.thresholds);
    expect(breaches, `baseline breached: ${breaches.join('; ')}`).toEqual([]);
  });
});

// A visible marker when the eval is asked for but cannot run.
describe.runIf(LIVE && !HAS_KEY)('agent live-model eval', () => {
  it('needs GEMINI_API_KEY', () => {
    throw new Error('AGENT_EVAL_LIVE=1 but no GEMINI_API_KEY — set it (or a BYOK key) to run the eval.');
  });
});
