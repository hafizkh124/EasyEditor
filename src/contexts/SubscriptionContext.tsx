import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { handleSupabaseError } from "@/lib/errors";
import type { Tables } from "@/integrations/supabase/types";

type Subscription = Tables<"subscriptions">;

interface SubscriptionContextType {
  subscription: Subscription | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType>({
  subscription: null,
  loading: true,
  refetch: async () => {},
});

export const useSubscription = () => useContext(SubscriptionContext);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    console.log("[SubscriptionContext] Fetching subscription for user:", user.id);
    setLoading(true);
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (error) {
      handleSupabaseError(error, "load subscription");
    } else {
      console.log(
        `[SubscriptionContext] Loaded — tier: ${data.tier} | STT used: ${data.transcription_seconds_used}s | TTS used: ${data.tts_characters_used} chars`
      );
      setSubscription(data);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const value = useMemo(
    () => ({ subscription, loading, refetch: fetchSubscription }),
    [subscription, loading, fetchSubscription]
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};
