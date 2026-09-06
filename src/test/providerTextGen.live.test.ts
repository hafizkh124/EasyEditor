// @vitest-environment node
// M9 Phase C — a LIVE smoke test for split routing: a provider that is NOT
// eval-verified may still generate plain text (draft_section / run_task).
// Skipped unless <PROVIDER>_API_KEY is set.
//
//   GROQ_API_KEY=... npx vitest run src/test/providerTextGen.live.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from '../../shared/agent/providers';

const targets = PROVIDER_IDS.filter((id) => process.env[PROVIDERS[id].keyEnvVar]);

let cfg: string;
beforeAll(() => {
  cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-')), 'pc.json');
  process.env.AGENT_PROVIDER_CONFIG_PATH = cfg;
});
afterAll(() => {
  delete process.env.AGENT_PROVIDER_CONFIG_PATH;
  try { fs.rmSync(path.dirname(cfg), { recursive: true, force: true }); } catch { /* ignore */ }
});

describe.runIf(targets.length > 0)('split routing — text generation on an unverified provider', () => {
  it.each(targets.map((id) => [id] as const))('%s generates plain text without being eval-verified', async (id: ProviderId) => {
    const { setTextProviderId, getTextProviderId, isProviderVerified } = await import('../../electron/ai/providerConfig');
    setTextProviderId(id);
    expect(getTextProviderId()).toBe(id);
    if (id !== 'gemini') expect(isProviderVerified(id)).toBe(false); // still unverified — text-gen is not gated

    const { generateAgentText } = await import('../../electron/agent/modelRouter');
    const out = await generateAgentText({
      prompt: 'Reply with exactly this token and nothing else: SPLIT-OK',
      systemInstruction: 'Output only what the user asks for.',
    });
    expect(out.toUpperCase()).toContain('SPLIT-OK');
  }, 60_000);

  it.each(targets.map((id) => [id] as const))('%s runs the reasoning-model critic (no tools) and finds the flaw', async (id: ProviderId) => {
    const { setCriticProviderId } = await import('../../electron/ai/providerConfig');
    setCriticProviderId(id);
    const { runCritique } = await import('../../electron/agent/critic');
    // A plan with an obvious ordering flaw: it drafts BEFORE retrieving sources.
    const r = await runCritique({
      kind: 'plan',
      subject: 'Plan:\n1. draft_section (prose) for the chapter on riba\n2. search_corpus for sources\n3. insert_footnote',
      context: 'The scholar asked for a sourced section on riba.',
    });
    if (!r.ok) {
      // A provider account limit (Groq free tier is TPM-limited) is not a code
      // failure — the critic degraded to a note, which is the designed behaviour.
      expect(r.text).toMatch(/unavailable|rate|تیز|quota/i);
      return;
    }
    expect(r.text.length).toBeGreaterThan(40);
    // it should notice that drafting precedes retrieval
    expect(r.text.toLowerCase()).toMatch(/before|order|retriev|first|source/);
  }, 90_000);
});
