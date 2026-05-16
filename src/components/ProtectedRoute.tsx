import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import ApprovalGate from "@/components/ApprovalGate";
import { useApproval } from "@/hooks/useApproval";

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const { isApproved, rejectionStatus, loading: approvalLoading } = useApproval();

  if (loading || approvalLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Rejected users are routed to a dedicated page so they understand why
  // they can't access the app and have a path to appeal via WhatsApp.
  if (rejectionStatus === "rejected") {
    return <Navigate to="/account-rejected" replace />;
  }

  // Unapproved users are redirected to a dedicated payment-instructions page
  // instead of being dumped on the dashboard with only a thin banner. The
  // ApprovalGate wrapper below remains as defense-in-depth for any edge cases.
  if (isApproved === false) {
    return <Navigate to="/pending-approval" replace />;
  }

  return (
    <ApprovalGate>
      {children}
    </ApprovalGate>
  );
};

export default ProtectedRoute;
