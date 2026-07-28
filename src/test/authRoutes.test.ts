import { describe, it, expect } from "vitest";

/**
 * Route protection logic unit test suite.
 * Evaluates access rules for pending, approved, lapsed, rejected, and admin users.
 */

export interface AuthState {
  user: { id: string; email: string } | null;
  isAdmin: boolean;
  profileComplete: boolean;
  isApproved: boolean;
  rejectionStatus: "none" | "rejected" | "pending";
  isLapsed: boolean;
}

const LAPSED_ALLOWLIST = new Set([
  "/pricing",
  "/checkout/success",
  "/profile",
  "/settings",
]);

export function evaluateRouteAccess(state: AuthState, pathname: string): { action: "render" | "redirect"; target?: string } {
  if (!state.user) {
    return { action: "redirect", target: "/login" };
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
});
