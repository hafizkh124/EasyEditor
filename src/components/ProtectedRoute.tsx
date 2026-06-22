import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useLocation } from "react-router-dom";
import ApprovalGate from "@/components/ApprovalGate";
import { useApproval } from "@/hooks/useApproval";
import { useSubscription } from "@/contexts/SubscriptionContext";

/** Routes that lapsed (post-grace) users can still reach so they can renew. */
const LAPSED_ALLOWLIST = new Set([
  "/pricing",
  "/checkout/success",
  "/profile",
  "/settings",
]);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const { isApproved, rejectionStatus, profileComplete, isAdmin, loading: approvalLoading } = useApproval();
  const { isLapsed, loading: subLoading } = useSubscription();
  const location = useLocation();

  if (loading || approvalLoading || subLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
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
