/**
 * M9 Phase C (ADR-0031) / M10 Phase 2.5.1 — the agent's OUTBOUND model-endpoint
 * allowlist, pulled out of electron/lib/agentModelAllowlist.ts so the web BYOK
 * path (Phase 2.5, agent-model edge function) enforces the exact same host
 * list a client-supplied baseUrl is checked against — never a bespoke,
 * possibly-looser check written a second time for the server.
 *
 * Distinct from electron/lib/urlAllowlist.ts, which gates `shell.openExternal`
 * (links the user's browser opens). This gates the hosts the agent's own model
 * clients may `fetch` — a second line of defence so a bad `baseUrl` in a
 * provider spec (or a client-supplied one, once BYOK adds that parameter)
 * cannot exfiltrate prompt text to an arbitrary host.
 */
import { PROVIDERS } from '../agent/providers.js';

const ALLOWED_MODEL_HOSTS: ReadonlySet<string> = new Set(
  Object.values(PROVIDERS).map((p) => p.host),
);

/** Throws unless `url` is https and its host is a known provider host. */
export function assertAllowedModelUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`model endpoint is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`model endpoint must be https: ${url}`);
  }
  if (!ALLOWED_MODEL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `model endpoint host "${parsed.hostname}" is not on the agent allowlist ` +
      `(${[...ALLOWED_MODEL_HOSTS].join(', ')})`,
    );
  }
  return parsed;
}

export function isAllowedModelHost(host: string): boolean {
  return ALLOWED_MODEL_HOSTS.has(host);
}
