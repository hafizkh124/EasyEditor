import { describe, it, expect } from "vitest";

/**
 * Route protection logic unit test suite.
 * Evaluates access rules for pending, approved, lapsed, rejected, and admin users.
 */

export interface AuthState {
  user: { id: string; email: string } | null;
  isAdmin: boolean;
  /** `null` = unknown, e.g. the profile fetch failed. Never treated as a "no". */
  profileComplete: boolean | null;
  /** `null` = unknown, e.g. the profile fetch failed. Never treated as a "no". */
  isApproved: boolean | null;
  rejectionStatus: "none" | "rejected" | "pending";
  isLapsed: boolean;
}

/**
 * How the route was declared and where it is running.
 * `allowGuest` marks a route that runs entirely on the local backend; `desktop`
 * is the Electron build. Together they make a route local-only.
 */
export interface RouteContext {
  allowGuest?: boolean;
  desktop?: boolean;
}

const LAPSED_ALLOWLIST = new Set([
  "/pricing",
  "/checkout/success",
  "/profile",
  "/settings",
]);

export function evaluateRouteAccess(
  state: AuthState,
  pathname: string,
  ctx: RouteContext = {},
): { action: "render" | "redirect"; target?: string } {
  // A local-only route renders unconditionally — no session, approval or
  // subscription check applies, because none of them govern local data. This is
  // what keeps the offline desktop app usable after an optional sign-in.
  if (ctx.allowGuest && ctx.desktop) {
    return { action: "render" };
  }

  if (!state.user) {
    // Desktop has no public login page to send anyone to.
    return { action: "redirect", target: ctx.desktop ? "/workspace" : "/login" };
  }

  if (state.rejectionStatus === "rejected") {
    return { action: "redirect", target: "/account-rejected" };
  }

  if (!state.isAdmin && state.profileComplete === false) {
    return { action: "redirect", target: "/complete-profile" };
  }

  if (state.isApproved === false) {
    return { action: "redirect", target: "/pending-approval" };
  }

  if (!state.isAdmin && state.isLapsed && !LAPSED_ALLOWLIST.has(pathname)) {
    return { action: "redirect", target: "/pricing?expired=true" };
  }

  return { action: "render" };
}

describe("ProtectedRoute logic", () => {
  const baseApprovedUser: AuthState = {
    user: { id: "user-1", email: "user@example.com" },
    isAdmin: false,
    profileComplete: true,
    isApproved: true,
    rejectionStatus: "none",
    isLapsed: false,
  };

  it("redirects unauthenticated user to /login", () => {
    const res = evaluateRouteAccess({ ...baseApprovedUser, user: null }, "/research");
    expect(res).toEqual({ action: "redirect", target: "/login" });
  });

  it("redirects rejected user to /account-rejected", () => {
    const res = evaluateRouteAccess({ ...baseApprovedUser, rejectionStatus: "rejected" }, "/research");
    expect(res).toEqual({ action: "redirect", target: "/account-rejected" });
  });

  it("redirects incomplete profile to /complete-profile", () => {
    const res = evaluateRouteAccess({ ...baseApprovedUser, profileComplete: false }, "/research");
    expect(res).toEqual({ action: "redirect", target: "/complete-profile" });
  });

  it("redirects unapproved user to /pending-approval", () => {
    const res = evaluateRouteAccess({ ...baseApprovedUser, isApproved: false }, "/research");
    expect(res).toEqual({ action: "redirect", target: "/pending-approval" });
  });

  it("redirects lapsed user attempting protected route to /pricing?expired=true", () => {
    const res = evaluateRouteAccess({ ...baseApprovedUser, isLapsed: true }, "/editor");
    expect(res).toEqual({ action: "redirect", target: "/pricing?expired=true" });
  });

  it("allows lapsed user to visit allowlisted route /settings", () => {
    const res = evaluateRouteAccess({ ...baseApprovedUser, isLapsed: true }, "/settings");
    expect(res).toEqual({ action: "render" });
  });

  it("allows admin user even if subscription is lapsed", () => {
    const res = evaluateRouteAccess({ ...baseApprovedUser, isAdmin: true, isLapsed: true }, "/editor");
    expect(res).toEqual({ action: "render" });
  });

  it("allows active approved user to access protected routes", () => {
    const res = evaluateRouteAccess(baseApprovedUser, "/research");
    expect(res).toEqual({ action: "render" });
  });

  it("does not redirect when approval status is unknown (failed fetch)", () => {
    const res = evaluateRouteAccess({ ...baseApprovedUser, isApproved: null }, "/research");
    expect(res).toEqual({ action: "render" });
  });
});

/**
 * Desktop (Electron) axis. The desktop build boots into the offline workspace
 * with no account, and signing in is optional — so these cases are as much
 * about what must NOT happen as about what does.
 */
describe("ProtectedRoute logic — desktop", () => {
  const guest: AuthState = {
    user: null,
    isAdmin: false,
    profileComplete: null,
    isApproved: null,
    rejectionStatus: "none",
    isLapsed: false,
  };
  const desktop = { desktop: true };

  it("renders an allowGuest route for a desktop guest", () => {
    const res = evaluateRouteAccess(guest, "/workspace", { ...desktop, allowGuest: true });
    expect(res).toEqual({ action: "render" });
  });

  it("sends a desktop guest on a non-guest route to /workspace, not /login", () => {
    const res = evaluateRouteAccess(guest, "/research", desktop);
    expect(res).toEqual({ action: "redirect", target: "/workspace" });
  });

  it("still sends a web guest to /login", () => {
    const res = evaluateRouteAccess(guest, "/workspace", { allowGuest: true });
    expect(res).toEqual({ action: "redirect", target: "/login" });
  });

  it("keeps the workspace open when a signed-in desktop user reads as unapproved", () => {
    // Offline: the profiles fetch fails, so approval cannot be confirmed.
    // Signing in once must never cost the user their offline workspace.
    const offlineSignedIn: AuthState = {
      ...guest,
      user: { id: "user-1", email: "user@example.com" },
      isApproved: false,
    };
    const res = evaluateRouteAccess(offlineSignedIn, "/workspace", { ...desktop, allowGuest: true });
    expect(res).toEqual({ action: "render" });
  });

  it("keeps Settings reachable for a desktop guest (BYOK + voice panels)", () => {
    const res = evaluateRouteAccess(guest, "/settings", { ...desktop, allowGuest: true });
    expect(res).toEqual({ action: "render" });
  });

  it("does not lock a lapsed desktop user out of the local workspace", () => {
    const lapsed: AuthState = {
      ...guest,
      user: { id: "user-1", email: "user@example.com" },
      isApproved: true,
      profileComplete: true,
      isLapsed: true,
    };
    const res = evaluateRouteAccess(lapsed, "/workspace", { ...desktop, allowGuest: true });
    expect(res).toEqual({ action: "render" });
  });
});
