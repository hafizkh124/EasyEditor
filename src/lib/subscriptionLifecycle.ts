export type LifecycleStatus = "none" | "active" | "expiring_soon" | "expired";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LifecycleInfo {
  status: LifecycleStatus;
  daysRemaining: number | null;
  expiresAt: Date | null;
  activatedAt: Date | null;
}

/**
 * Compute lifecycle status from a subscription row. Free-tier users (no
 * activation) get status "none". Otherwise: active (>7d remaining),
 * expiring_soon (≤7d), or expired (past expiry).
 */
export function getLifecycleInfo(args: {
  tier: string;
  activatedAt: string | null;
  expiresAt: string | null;
}): LifecycleInfo {
  if (args.tier === "free" || !args.activatedAt || !args.expiresAt) {
    return { status: "none", daysRemaining: null, expiresAt: null, activatedAt: null };
  }
  const activatedAt = new Date(args.activatedAt);
  const expiresAt = new Date(args.expiresAt);
  const diffMs = expiresAt.getTime() - Date.now();
  const daysRemaining = Math.ceil(diffMs / DAY_MS);

  let status: LifecycleStatus;
  if (diffMs <= 0) status = "expired";
  else if (daysRemaining <= 7) status = "expiring_soon";
  else status = "active";

  return { status, daysRemaining, expiresAt, activatedAt };
}

export function formatLifecycleDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
