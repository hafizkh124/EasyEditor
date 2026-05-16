import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const useApproval = () => {
  // P2: Use session from AuthContext instead of redundant auth calls
  const { user, session } = useAuth();
  const [isApproved, setIsApproved] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rejectionStatus, setRejectionStatus] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    if (!user || !session) {
      setIsApproved(null);
      setIsAdmin(false);
      setRejectionStatus(null);
      setRejectionReason(null);
      setLoading(false);
      return;
    }
    const userId = session.user.id;
    const [profileRes, roleRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("is_approved, rejection_status, rejection_reason")
        .eq("user_id", userId)
        .single(),
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    ]);

    setIsApproved(profileRes.data?.is_approved ?? false);
    setRejectionStatus((profileRes.data as { rejection_status?: string | null } | null)?.rejection_status ?? null);
    setRejectionReason((profileRes.data as { rejection_reason?: string | null } | null)?.rejection_reason ?? null);
    setIsAdmin(roleRes.data === true);
    setLoading(false);
  }, [user, session]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { isApproved, isAdmin, rejectionStatus, rejectionReason, loading, refetch: fetchStatus };
};
