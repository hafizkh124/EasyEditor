import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const useApproval = () => {
  const { user } = useAuth();
  const [isApproved, setIsApproved] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsApproved(null);
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const fetchStatus = async () => {
      const [profileRes, roleRes] = await Promise.all([
        supabase.from("profiles").select("is_approved").eq("user_id", user.id).single(),
        supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      ]);

      setIsApproved(profileRes.data?.is_approved ?? false);
      setIsAdmin(roleRes.data === true);
      setLoading(false);
    };

    fetchStatus();
  }, [user]);

  return { isApproved, isAdmin, loading };
};
