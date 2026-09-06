/**
 * M9 Phase C (ADR-0031) — the agent's OUTBOUND model-endpoint allowlist.
 *
 * Distinct from electron/lib/urlAllowlist.ts, which gates `shell.openExternal`
 * (links the user's browser opens). This gates the hosts the agent's own model
 * clients may `fetch` — a second line of defence so a bad `baseUrl` in a
 * provider spec (or a future config field) cannot exfiltrate prompt text to an
 * arbitrary host.
 */
import { PROVIDERS } from '../../shared/agent/providers.js';

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
