/**
 * Connectors Hub — the health-probe result shape.
 *
 * Pure types only (shared/ purity rule). The probe itself runs in the Electron
 * main process (`electron/ipc/connectorsHandlers.ts`) keyed by the connector's
 * `healthKind`; the renderer calls it through `src/lib/connectors/health.ts`
 * and renders the badge.
 */

export interface HealthResult {
  /**
   * `true`  — reachable / present.
   * `false` — a real failure (offline, missing file, MCP error).
   * `null`  — not knowable here (a `bridged` connector, checked at query time).
   */
  ok: boolean | null;
  /** Round-trip time for `http` / `mcp` probes, when `ok` is true. */
  latencyMs?: number | null;
  /** A one-line reason shown under a 🔴 badge, or a note under a ⚪/n-a badge. */
  detail?: string;
  /** Set only on `ok: false` — the raw error, for the "copy report" button. */
  error?: string;
}
