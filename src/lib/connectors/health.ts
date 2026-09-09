/**
 * Connectors Hub — the renderer-side health probe.
 *
 * Thin wrapper over `window.electronAPI.connectors.ping`. On web (no
 * `electronAPI`) every connector reports "unknown" — the Hub is a desktop
 * surface this milestone.
 */
import type { HealthResult } from "~shared/connectors/health";

export type { HealthResult };

export async function pingConnector(id: string): Promise<HealthResult> {
  const api = typeof window !== "undefined" ? window.electronAPI?.connectors : undefined;
  if (!api?.ping) return { ok: null, detail: "connector health is a desktop feature" };
  try {
    return await api.ping(id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), detail: "the health check failed to run" };
  }
}
