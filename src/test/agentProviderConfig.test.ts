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

describe('text provider (split routing — M9)', () => {
  it('defaults to the loop provider', () => {
    expect(mod.getTextProviderId()).toBe('gemini');
    mod.markProviderVerified('groq', true);
    mod.setActiveProviderId('groq');
    expect(mod.getTextProviderId()).toBe('groq'); // follows active when unset
  });

  it('can be set independently of the loop provider, with NO eval gate', () => {
    // groq is NOT verified — still allowed as the text provider
    mod.setTextProviderId('groq');
    expect(mod.getTextProviderId()).toBe('groq');
    expect(mod.getActiveProviderId()).toBe('gemini'); // loop unchanged
  });

  it('clears back to following the loop provider', () => {
    mod.setTextProviderId('openrouter');
    expect(mod.getTextProviderId()).toBe('openrouter');
    mod.setTextProviderId(null);
    expect(mod.getTextProviderId()).toBe('gemini');
  });
});

describe('critic provider (reasoning-model critic — §4)', () => {
  it('defaults to the text provider, and is not eval-gated', () => {
    expect(mod.getCriticProviderId()).toBe('gemini');
    mod.setTextProviderId('groq'); // groq unverified — still fine for text
    expect(mod.getCriticProviderId()).toBe('groq'); // follows text when unset
    mod.setCriticProviderId('openrouter');
    expect(mod.getCriticProviderId()).toBe('openrouter');
    expect(mod.getActiveProviderId()).toBe('gemini'); // the loop is untouched
  });
});

describe('resolveProvider env overrides', () => {
  it('applies <ID>_TOOL_MODEL', () => {
    process.env.GROQ_TOOL_MODEL = 'qwen-3-next';
    expect(mod.resolveProvider('groq').toolModel).toBe('qwen-3-next');
    expect(mod.resolveProvider('gemini').toolModel).toBe('gemini-2.5-flash');
  });
});
