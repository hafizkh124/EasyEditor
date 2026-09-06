// @vitest-environment node
// electron/lib/agentModelAllowlist.ts (M9 Phase C) — the agent's outbound
// model-endpoint allowlist. Every provider host is allowed; nothing else is.
import { describe, it, expect } from 'vitest';
import { assertAllowedModelUrl, isAllowedModelHost } from '../../electron/lib/agentModelAllowlist';
import { PROVIDERS, PROVIDER_IDS } from '../../shared/agent/providers';

describe('agent model allowlist', () => {
  it('allows every registered provider host', () => {
    for (const id of PROVIDER_IDS) expect(isAllowedModelHost(PROVIDERS[id].host)).toBe(true);
  });

  it('accepts an https URL on a provider host and returns the parsed URL', () => {
    const u = assertAllowedModelUrl('https://api.groq.com/openai/v1/chat/completions');
    expect(u.hostname).toBe('api.groq.com');
  });

  it('rejects a non-provider host', () => {
    expect(() => assertAllowedModelUrl('https://evil.example.com/v1/chat/completions')).toThrow(/not on the agent allowlist/);
  });

  it('rejects http (no TLS) even on an allowed host', () => {
    expect(() => assertAllowedModelUrl('http://api.groq.com/openai/v1/chat/completions')).toThrow(/must be https/);
  });

  it('rejects a malformed URL', () => {
    expect(() => assertAllowedModelUrl('not a url')).toThrow(/valid URL/);
  });
});
