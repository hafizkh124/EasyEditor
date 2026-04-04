import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const useApproval = () => {
  // P2: Use session from AuthContext instead of redundant auth calls
  const { user, session } = useAuth();
  const [isApproved, setIsApproved] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !session) {
      setIsApproved(null);
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const fetchStatus = async () => {
      const userId = session.user.id;
      const [profileRes, roleRes] = await Promise.all([
        supabase.from("profiles").select("is_approved").eq("user_id", userId).single(),
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      ]);

      setIsApproved(profileRes.data?.is_approved ?? false);
      setIsAdmin(roleRes.data === true);
      setLoading(false);
    };

    fetchStatus();
  }, [user, session]);

  return { isApproved, isAdmin, loading };
};
