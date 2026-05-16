export type UpgradeTarget = "basic" | "pro" | "ultra";

/**
 * Given the user's current subscription tier, return the next tier they can
 * upgrade to, or `null` if they're already on the highest plan (Ultra).
 *
 * Order: free → basic → pro → ultra → (no upgrade).
 */
export function getNextTier(currentTier: string | null | undefined): UpgradeTarget | null {
  if (currentTier === "free") return "basic";
  if (currentTier === "basic") return "pro";
  if (currentTier === "pro") return "ultra";
  return null;
}

/**
 * i18n key for the "Upgrade to X" button label based on the next tier.
 * Returns null when there's no higher tier.
 */
export function getUpgradeLabelKey(currentTier: string | null | undefined): string | null {
  const next = getNextTier(currentTier);
  if (!next) return null;
  return `dashboard.upgrade_to_${next}`;
}
