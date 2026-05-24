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
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    if (!user || !session) {
      setIsApproved(null);
      setIsAdmin(false);
      setRejectionStatus(null);
      setRejectionReason(null);
      setProfileComplete(null);
      setDisplayName(null);
      setLoading(false);
      return;
    }
    const userId = session.user.id;
    const [profileRes, roleRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("is_approved, rejection_status, rejection_reason, whatsapp_number, display_name")
        .eq("user_id", userId)
        .single(),
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    ]);

    const profileData = profileRes.data as {
      is_approved?: boolean | null;
      rejection_status?: string | null;
      rejection_reason?: string | null;
      whatsapp_number?: string | null;
      display_name?: string | null;
    } | null;

    setIsApproved(profileData?.is_approved ?? false);
    setRejectionStatus(profileData?.rejection_status ?? null);
    setRejectionReason(profileData?.rejection_reason ?? null);
    setProfileComplete(!!profileData?.whatsapp_number);
    setDisplayName(profileData?.display_name ?? null);
    setIsAdmin(roleRes.data === true);
    setLoading(false);
  }, [user, session]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    isApproved,
    isAdmin,
    rejectionStatus,
    rejectionReason,
    profileComplete,
    displayName,
    loading,
    refetch: fetchStatus,
  };
};
