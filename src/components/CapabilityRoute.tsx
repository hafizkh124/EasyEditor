import React from "react";
import { Navigate } from "react-router-dom";
import { isCapabilityAvailable, capabilityUnavailableReason } from "@/core/capabilities/registry";
import type { CapabilityId } from "@/core/capabilities/registry";
import { isDesktop } from "@/utils/environment";
import { logger } from "@/lib/logger";

const log = logger.child("capabilities");

/**
 * Route-level half of the capability registry.
 *
 * Hiding a nav entry stops users stumbling into a feature their build cannot
 * run, but it leaves the route itself reachable — by a typed URL, a stale
 * bookmark, a deep link, or `history.back()` after the runtime changed. Those
 * land on a page whose every action fails. This closes that hole so absence is
 * enforced at the route, not just decorated in the menu.
 */
const CapabilityRoute: React.FC<{ id: CapabilityId; children: React.ReactNode }> = ({ id, children }) => {
  if (isCapabilityAvailable(id)) return <>{children}</>;

  if (import.meta.env.DEV) {
    log.warn(`"${id}" is unavailable on this runtime: ${capabilityUnavailableReason(id)}`);
  }

  // Desktop has no dashboard-first flow and no public landing page, so the
  // workspace is its only sensible home.
  return <Navigate to={isDesktop() ? "/workspace" : "/dashboard"} replace />;
};

export default CapabilityRoute;
