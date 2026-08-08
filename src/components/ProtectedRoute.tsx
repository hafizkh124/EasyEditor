import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useLocation } from "react-router-dom";
import ApprovalGate from "@/components/ApprovalGate";
import { useApproval } from "@/hooks/useApproval";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { isDesktop } from "@/utils/environment";

/** Routes that lapsed (post-grace) users can still reach so they can renew. */
const LAPSED_ALLOWLIST = new Set([
  "/pricing",
  "/checkout/success",
  "/profile",
  "/settings",
]);

/**
 * `allowGuest` marks a route as reachable in the Electron desktop build with no
 * Supabase session at all. These routes run entirely on the local backend —
 * `getBackend()` returns `localBackend` on desktop unconditionally — so cloud
 * entitlement has no bearing on whether they may render. The web build is
 * untouched and keeps its login gate.
 *
 * The bypass covers the approval and subscription gates too, not just the "you
 * must log in" check, and it applies to a signed-in desktop user as well. That
 * is deliberate: those gates read `profiles` / `subscriptions` over the network,
 * and `useApproval` cannot tell "request failed" from "not approved" — so a
 * desktop user who signed in once and later opened the app offline was pushed
 * to /pending-approval, a page with no route back to the workspace. Signing in
 * is optional here; it must never be able to take the offline app away.
 */
interface ProtectedRouteProps {
  children: React.ReactNode;
  allowGuest?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowGuest }) => {
  const { user, loading } = useAuth();
  const { isApproved, rejectionStatus, profileComplete, isAdmin, loading: approvalLoading } = useApproval();
  const { isLapsed, loading: subLoading } = useSubscription();
  const location = useLocation();

  const localOnlyRoute = Boolean(allowGuest) && isDesktop();

  if (loading || (!localOnlyRoute && (approvalLoading || subLoading))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (localOnlyRoute) {
    return <>{children}</>;
  }

  if (!user) {
    // Desktop has no public login page, so every other protected page falls
    // back to the workspace rather than a sign-in wall.
    return <Navigate to={isDesktop() ? "/workspace" : "/login"} replace />;
  }

  if (rejectionStatus === "rejected") {
    return <Navigate to="/account-rejected" replace />;
  }

  if (!isAdmin && profileComplete === false) {
    return <Navigate to="/complete-profile" replace />;
  }

  if (isApproved === false) {
    return <Navigate to="/pending-approval" replace />;
  }

  // Subscription expired beyond the 7-day grace period — lock features.
  // Admins are exempt. Allowlisted routes (pricing/profile/settings) remain
  // reachable so the user can renew or view billing info.
  if (!isAdmin && isLapsed && !LAPSED_ALLOWLIST.has(location.pathname)) {
    return <Navigate to="/pricing?expired=true" replace />;
  }

  return (
    <ApprovalGate>
      {children}
    </ApprovalGate>
  );
};

export default ProtectedRoute;
