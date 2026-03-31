import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import ApprovalGate from "@/components/ApprovalGate";

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <ApprovalGate>
      {children}
    </ApprovalGate>
  );
};

export default ProtectedRoute;
