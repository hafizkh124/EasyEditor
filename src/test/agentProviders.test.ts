// @vitest-environment node
// shared/agent/providers.ts (M9 Phase C, ADR-0031) — the static provider registry.
import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_IDS, DEFAULT_PROVIDER, getProvider, isProviderId } from '../../shared/agent/providers';

describe('provider registry', () => {
  it('has gemini as the default and every id resolvable', () => {
    expect(DEFAULT_PROVIDER).toBe('gemini');
    expect(PROVIDER_IDS).toEqual(expect.arrayContaining(['gemini', 'groq', 'openrouter']));
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].id).toBe(id);
  });

  it('gemini uses its own wire format; groq and openrouter are openai-compatible', () => {
    expect(PROVIDERS.gemini.kind).toBe('gemini');
    expect(PROVIDERS.groq.kind).toBe('openai-compat');
    expect(PROVIDERS.openrouter.kind).toBe('openai-compat');
  });

  it('every openai-compat provider has an https base URL and a distinct host', () => {
    const hosts = new Set<string>();
    for (const id of PROVIDER_IDS) {
      const p = PROVIDERS[id];
      if (p.kind === 'openai-compat') expect(p.baseUrl).toMatch(/^https:\/\//);
      expect(hosts.has(p.host)).toBe(false);
      hosts.add(p.host);
    }
  });

  it('key patterns match a sample key and reject a foreign one', () => {
    expect(PROVIDERS.gemini.keyPattern.test('AIzaSyAbCdEf012345678901234567890123456')).toBe(true);
    expect(PROVIDERS.groq.keyPattern.test('gsk_abcDEF0123456789abcDEF0123')).toBe(true);
    expect(PROVIDERS.openrouter.keyPattern.test('sk-or-v1-0123456789abcdef0123456789abcdef')).toBe(true);
    expect(PROVIDERS.groq.keyPattern.test('AIzaSyAbCdEf012345678901234567890123456')).toBe(false);
  });

  it('openrouter carries a privacy note (third-party routing); gemini does not', () => {
    expect(PROVIDERS.openrouter.privacyNote).toMatch(/outside the EU\/US|third-party/i);
    expect(PROVIDERS.gemini.privacyNote).toBeUndefined();
  });

  it('a reasoning model is declared only where one exists, and is never the tool model', () => {
    for (const id of PROVIDER_IDS) {
      const p = PROVIDERS[id];
      if (p.reasoningModel) expect(p.reasoningModel).not.toBe(p.toolModel);
    }
  });

  it('isProviderId / getProvider fall back to gemini for junk', () => {
    expect(isProviderId('groq')).toBe(true);
    expect(isProviderId('anthropic')).toBe(false);
    expect(getProvider('nonsense').id).toBe('gemini');
    expect(getProvider(null).id).toBe('gemini');
    expect(getProvider('openrouter').id).toBe('openrouter');
  });
});
