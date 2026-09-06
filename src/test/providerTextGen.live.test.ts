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
});
