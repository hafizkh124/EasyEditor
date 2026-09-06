/**
 * M9 Phase C (ADR-0031) — which provider the desktop agent runs on.
 *
 * Persists `{ active, verified }` to `userData/agent-provider.json`:
 *  - `active`   — the provider every agent task uses (default 'gemini').
 *  - `verified` — providers that have cleared the Phase B eval on THIS machine.
 *
 * The gate: `setActiveProvider` refuses a non-Gemini provider that is not in
 * `verified`. A provider is marked verified by `markProviderVerified` — called
 * from the Settings panel after the scholar has run the live eval and seen it
 * pass (the eval prints the exact command and the "you may mark it verified"
 * line), or by the eval itself via `AGENT_EVAL_MARK_VERIFIED=1`.
 *
 * Model ids drift; every one can be overridden per provider with an env var.
 */
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {
  PROVIDERS, DEFAULT_PROVIDER, isProviderId,
  type ProviderId, type ProviderSpec,
} from '../../shared/agent/providers.js';

interface ProviderConfigFile {
  active: ProviderId;
  verified: ProviderId[];
}

function configPath(): string {
  const override = process.env.AGENT_PROVIDER_CONFIG_PATH;
  if (override) return override;
  return path.join(app.getPath('userData'), 'agent-provider.json');
}

function read(): ProviderConfigFile {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<ProviderConfigFile>;
    return {
      active: isProviderId(raw.active) ? raw.active : DEFAULT_PROVIDER,
      verified: Array.isArray(raw.verified) ? raw.verified.filter(isProviderId) : [],
    };
  } catch {
    return { active: DEFAULT_PROVIDER, verified: [] };
  }
}

function write(cfg: ProviderConfigFile): void {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch { /* best effort — falls back to defaults next read */ }
}

/** Gemini is always verified; others must clear the eval on this machine. Env can force-add for CI/eval. */
export function verifiedProviders(): ProviderId[] {
  const fromEnv = (process.env.AGENT_VERIFIED_PROVIDERS ?? '').split(',').map((s) => s.trim()).filter(isProviderId);
  return [...new Set<ProviderId>(['gemini', ...read().verified, ...fromEnv])];
}

export function isProviderVerified(id: ProviderId): boolean {
  return verifiedProviders().includes(id);
}

export function getActiveProviderId(): ProviderId {
  const id = read().active;
  // A provider that lost its verification (config edited) falls back to Gemini.
  return id === 'gemini' || isProviderVerified(id) ? id : DEFAULT_PROVIDER;
}

export function setActiveProviderId(id: ProviderId): void {
  if (id !== 'gemini' && !isProviderVerified(id)) {
    throw new Error(`${PROVIDERS[id].label} has not passed the agent eval on this machine yet — run it first (Settings shows the command).`);
  }
  const cfg = read();
  write({ ...cfg, active: id });
}

export function markProviderVerified(id: ProviderId, verified: boolean): void {
  const cfg = read();
  const set = new Set(cfg.verified);
  if (verified) set.add(id); else set.delete(id);
  const next: ProviderConfigFile = { ...cfg, verified: [...set] };
  if (!verified && cfg.active === id) next.active = DEFAULT_PROVIDER;
  write(next);
}

/** A provider spec with `<ID>_TOOL_MODEL` / `_TEXT_MODEL` / `_REASONING_MODEL` env overrides applied. */
export function resolveProvider(id: ProviderId): ProviderSpec {
  const spec = PROVIDERS[id];
  const up = id.toUpperCase();
  return {
    ...spec,
    toolModel: process.env[`${up}_TOOL_MODEL`]?.trim() || spec.toolModel,
    textModel: process.env[`${up}_TEXT_MODEL`]?.trim() || spec.textModel,
    reasoningModel: process.env[`${up}_REASONING_MODEL`]?.trim() || spec.reasoningModel,
  };
}
