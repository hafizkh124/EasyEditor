// @vitest-environment node
// M9 Phase B/C — the LIVE-model quality eval (ADR-0030 / ADR-0031).
//
// The 27 other agent tests prove the CONTRACT with a scripted ModelFn. This
// one proves the QUALITY of the real model's decisions: does it retrieve
// before it cites, never invent a source, pick the right tool, honour a forced
// (playbook bind) call, and stop when the job is done.
//
// Skipped unless AGENT_EVAL_LIVE=1 AND the chosen provider's key is set. It
// calls a real model API — it costs tokens and needs a network. CI never runs it.
//
//   GEMINI_API_KEY=... AGENT_EVAL_LIVE=1 npx vitest run src/test/agentEval.live.test.ts
//
// Phase C — verify a candidate provider against the SAME golden set + baseline:
//   GROQ_API_KEY=... EVAL_PROVIDER=groq AGENT_EVAL_LIVE=1 npx vitest run src/test/agentEval.live.test.ts
//
// Stamp a fresh baseline after a deliberate change (Gemini only — the baseline
// is the Gemini reference every provider must clear):
//   ... AGENT_EVAL_WRITE_BASELINE=1 npx vitest run src/test/agentEval.live.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { runAgentLoop } from '../../shared/agent/loop';
import { buildSystemPrompt } from '../../shared/agent/systemPrompt';
import { toolsFor } from '../../shared/agent/toolScoping';
import { resolvePlaybook } from '../../shared/playbooks/registry';
import { isProviderId } from '../../shared/agent/providers';
import { resolveProvider } from '../../electron/ai/providerConfig';
import { generateWithTools, generateBoundCall } from '../../electron/agent/geminiTools';
import { makeOpenAiCompatModel } from '../../electron/agent/openAiCompatTools';
import { getProviderKey } from '../../electron/ai/keyStore';
import { runPlaybook } from '../../electron/agent/runPlaybook';
import { makeScriptedDispatch } from './fixtures/agentEval/world';
import { SCENARIOS, type EvalScenario } from './fixtures/agentEval/scenarios';
import {
  scoreScenario, summarise, checkBaseline,
  type ScenarioScore, type EvalBaseline,
} from './fixtures/agentEval/score';
import type { AgentMessage, AgentTool, ModelStep } from '../../shared/agent/types';

const LIVE = process.env.AGENT_EVAL_LIVE === '1';
const PROVIDER_ID = isProviderId(process.env.EVAL_PROVIDER) ? process.env.EVAL_PROVIDER : 'gemini';
const provider = resolveProvider(PROVIDER_ID); // honours <ID>_TOOL_MODEL / _TEXT_MODEL overrides
const WRITE_BASELINE = process.env.AGENT_EVAL_WRITE_BASELINE === '1';
const LABEL = process.env.EVAL_MODEL_LABEL ?? provider.toolModel;

const BASELINE_PATH = path.resolve(__dirname, 'fixtures/agentEval/baseline.json');
const REPORT_DIR = path.resolve(__dirname, '../../test-results');

const caps = { word: true, wordVersion: '16.0', windows: true } as const;

interface Model {
  generate: (m: AgentMessage[], t: AgentTool[], s: string) => Promise<ModelStep>;
  generateBound: (m: AgentMessage[], t: AgentTool, s: string) => Promise<{ name: string; args: Record<string, unknown> }>;
}

async function buildModel(): Promise<Model | null> {
  const key = await getProviderKey(provider.id);
  if (!key) return null;
  if (provider.kind === 'gemini') {
    return { generate: (m, t, s) => generateWithTools(m, t, s), generateBound: (m, t, s) => generateBoundCall(m, t, s) };
  }
  const oc = makeOpenAiCompatModel(provider, key);
  return { generate: oc.generate, generateBound: oc.generateBound };
}

async function runOneScenario(sc: EvalScenario, model: Model): Promise<ScenarioScore> {
  const { dispatch, calls } = makeScriptedDispatch(sc.world);
  const systemPrompt = buildSystemPrompt({ mode: sc.mode, capabilities: caps, chapters: Object.keys(sc.world.chapters) });

  if (sc.kind === 'playbook') {
    const pb = resolvePlaybook(sc.playbook!);
    if (!pb) throw new Error(`scenario ${sc.id}: unknown playbook ${sc.playbook}`);
    const result = await runPlaybook({
      playbook: pb,
      instruction: sc.instruction,
      mode: sc.mode,
      context: { chapter: sc.chapter, instruction: sc.instruction, mentions: {} },
      dispatch,
      model,
      systemPrompt,
      fallbackTools: toolsFor(sc.mode, { playbook: pb }),
    });
    return scoreScenario(sc, result, calls);
  }

  const result = await runAgentLoop(sc.instruction, model.generate, dispatch, systemPrompt, {
    mode: sc.mode,
    tools: toolsFor(sc.mode, { ask: sc.instruction }),
    maxSteps: 16,
  });
  return scoreScenario(sc, result, calls);
}

describe.runIf(LIVE)(`agent live-model eval (${PROVIDER_ID})`, () => {
  const scores: ScenarioScore[] = [];
  let model: Model | null = null;

  it('has a key for the chosen provider', async () => {
    model = await buildModel();
    expect(model, `AGENT_EVAL_LIVE=1 with EVAL_PROVIDER=${PROVIDER_ID} but ${provider.keyEnvVar} is not set`).not.toBeNull();
  });

  afterAll(() => {
    if (scores.length === 0) return;
    const summary = summarise(scores);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const report = { provider: PROVIDER_ID, model: LABEL, ranAt: new Date().toISOString(), summary, scenarios: scores };
    fs.writeFileSync(path.join(REPORT_DIR, `agent-eval.${PROVIDER_ID}.json`), JSON.stringify(report, null, 2));

    // eslint-disable-next-line no-console
    console.log(
      `\n── agent eval (${PROVIDER_ID} · ${LABEL}) ──\n` +
      scores.map((s) => `  ${s.pass ? '✓' : '✗'} ${s.id}  (${s.metrics.steps} steps, ${s.metrics.footnotesInserted}/${s.metrics.footnotesAttempted} fn)`).join('\n') +
      `\n  passRate ${(summary.passRate * 100).toFixed(0)}%  ·  citationResolve ${(summary.citationResolveRate * 100).toFixed(0)}%  ·  violations ${summary.groundingViolations}  ·  meanSteps ${summary.meanSteps.toFixed(1)}\n`,
    );

    if (WRITE_BASELINE && PROVIDER_ID === 'gemini') {
      const next = {
        _note: 'Stamped by AGENT_EVAL_WRITE_BASELINE=1 (gemini). Hand-tighten so a genuine regression trips the gate.',
        model: LABEL,
        recordedAt: report.ranAt,
        thresholds: {
          minPassRate: +(summary.passRate - 0.1).toFixed(2),
          minCitationResolveRate: +(summary.citationResolveRate - 0.1).toFixed(2),
          maxGroundingViolations: summary.groundingViolations,
          maxMeanSteps: Math.ceil(summary.meanSteps + 2),
        },
      };
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
    }
  });

  // A playbook scenario can fall through to the free loop and run its full step
  // budget of real calls — 3 min covers it.
  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s', async (_id, sc) => {
    if (!model) return; // key-check test already failed loudly
    // Free tiers (Groq) are tokens-per-minute limited — breathe between scenarios.
    if (PROVIDER_ID !== 'gemini') await new Promise((r) => setTimeout(r, 8000));
    const score = await runOneScenario(sc, model);
    scores.push(score);
    const failed = score.checks.filter((c) => !c.pass);
    expect(failed, `${sc.id} failed: ${failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}`).toEqual([]);
  }, 180_000);

  it('meets the regression baseline', () => {
    if (scores.length === 0) return;
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as { thresholds: EvalBaseline };
    const breaches = checkBaseline(summarise(scores), baseline.thresholds);
    expect(breaches, `${PROVIDER_ID} baseline breached: ${breaches.join('; ')}`).toEqual([]);
  });
});
