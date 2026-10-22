import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * useApproval is mounted by the route guard, the gate, the account menu, the
 * banner and the page at once; each used to issue its own profile + has_role
 * pair (3x each on one load). Concurrent and just-finished reads for the same
 * user now share one request; `refetch` bypasses it.
 */
const SHARE_MS = 5_000;
let shared: { userId: string; at: number; promise: ReturnType<typeof fetchRaw> } | null = null;

function fetchRaw(userId: string) {
  return Promise.all([
    supabase
      .from("profiles")
      .select("is_approved, rejection_status, rejection_reason, whatsapp_number, display_name")
      .eq("user_id", userId)
      .single(),
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
  ]);
}

function fetchShared(userId: string, force: boolean) {
  if (!force && shared && shared.userId === userId && Date.now() - shared.at < SHARE_MS) {
    return shared.promise;
  }
  const promise = fetchRaw(userId);
  shared = { userId, at: Date.now(), promise };
  return promise;
}

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

  const fetchStatus = useCallback(async (force = true) => {
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
    const [profileRes, roleRes] = await fetchShared(userId, force);

    // A failed request is NOT a "not approved" answer. Collapsing the two sent
    // users whose profile fetch merely failed (offline, transient 5xx) to
    // /pending-approval and locked the app behind ApprovalGate. When we could
    // not read the profile, leave every flag at "unknown" (null) — the callers
    // gate on the explicit `=== false`, so unknown means "don't act on it".
    //
    // PGRST116 ("no matching record") is excluded on purpose: that IS a real
    // answer — a user with no profile row genuinely is not approved yet, and
    // must still be sent to /pending-approval.
    if (profileRes.error && profileRes.error.code !== "PGRST116") {
      setIsApproved(null);
      setRejectionStatus(null);
      setRejectionReason(null);
      setProfileComplete(null);
      setDisplayName(null);
      setIsAdmin(roleRes.data === true);
      setLoading(false);
      return;
    }

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
    fetchStatus(false);
  }, [fetchStatus]);

  return {
    isApproved,
    isAdmin,
    rejectionStatus,
    rejectionReason,
    profileComplete,
    displayName,
    loading,
    refetch: () => fetchStatus(true),
  };
};
