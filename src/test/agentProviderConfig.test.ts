// @vitest-environment node
// electron/ai/providerConfig.ts (M9 Phase C, ADR-0031) — active-provider
// persistence + the "verified on this machine" gate.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('no app in test'); } } }));

let cfgPath: string;
let mod: typeof import('../../electron/ai/providerConfig');

beforeEach(async () => {
  cfgPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'provcfg-')), 'agent-provider.json');
  process.env.AGENT_PROVIDER_CONFIG_PATH = cfgPath;
  delete process.env.AGENT_VERIFIED_PROVIDERS;
  vi.resetModules();
  mod = await import('../../electron/ai/providerConfig');
});
afterEach(() => {
  delete process.env.AGENT_PROVIDER_CONFIG_PATH;
  delete process.env.AGENT_VERIFIED_PROVIDERS;
  delete process.env.GROQ_TOOL_MODEL;
  try { fs.rmSync(path.dirname(cfgPath), { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('active provider', () => {
  it('defaults to gemini with no config file', () => {
    expect(mod.getActiveProviderId()).toBe('gemini');
  });

  it('refuses to activate an unverified non-Gemini provider', () => {
    expect(() => mod.setActiveProviderId('groq')).toThrow(/has not passed the agent eval/);
    expect(mod.getActiveProviderId()).toBe('gemini');
  });

  it('activates groq once it is marked verified, and reverts if verification is removed', () => {
    mod.markProviderVerified('groq', true);
    mod.setActiveProviderId('groq');
    expect(mod.getActiveProviderId()).toBe('groq');

    mod.markProviderVerified('groq', false);
    expect(mod.getActiveProviderId()).toBe('gemini'); // active fell back
  });

  it('AGENT_VERIFIED_PROVIDERS env can force-verify (for the eval / CI)', async () => {
    process.env.AGENT_VERIFIED_PROVIDERS = 'groq';
    vi.resetModules();
    mod = await import('../../electron/ai/providerConfig');
    expect(mod.isProviderVerified('groq')).toBe(true);
    mod.setActiveProviderId('groq');
    expect(mod.getActiveProviderId()).toBe('groq');
  });
});

describe('resolveProvider env overrides', () => {
  it('applies <ID>_TOOL_MODEL', () => {
    process.env.GROQ_TOOL_MODEL = 'qwen-3-next';
    expect(mod.resolveProvider('groq').toolModel).toBe('qwen-3-next');
    expect(mod.resolveProvider('gemini').toolModel).toBe('gemini-2.5-flash');
  });
});
