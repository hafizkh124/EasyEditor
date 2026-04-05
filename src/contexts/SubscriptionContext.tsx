import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { handleSupabaseError } from "@/lib/errors";
import type { Tables } from "@/integrations/supabase/types";

type Subscription = Tables<"subscriptions">;

/**
 * Canonical per-tier DB column values.
 * Used by Admin when approving upgrades so the limit columns always
 * stay in sync with the tier. Import this instead of hardcoding numbers.
 */
/**
 * Canonical per-tier limits.
 * 'free' = unapproved/pending state → all zeros (no access until admin assigns a plan).
 * Prices (PKR/month): Basic = 1,000 | Pro = 4,000 | Ultra = 7,000
 */
export const TIER_LIMITS = {
  free: {
    transcription_limit: 0,
    tts_character_limit: 0,
    ocr_pages_limit: 0,
    research_queries_limit: 0,
  },
  basic: {
    transcription_limit: 1_800,    // 30 minutes
    tts_character_limit: 0,        // TTS not included (Ultra only)
    ocr_pages_limit: 30,
    research_queries_limit: 20,
  },
  pro: {
    transcription_limit: 18_000,   // 5 hours
    tts_character_limit: 0,        // TTS not included (Ultra only)
    ocr_pages_limit: 300,
    research_queries_limit: 200,
  },
  ultra: {
    transcription_limit: 36_000,   // 10 hours — reserved for future launch
    tts_character_limit: 500_000,
    ocr_pages_limit: 2_000,
    research_queries_limit: 500,
  },
} as const;

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
    if (import.meta.env.DEV) console.log("[SubscriptionContext] Fetching subscription for user:", user.id);
    setLoading(true);
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (error) {
      handleSupabaseError(error, "load subscription");
    } else {
      if (import.meta.env.DEV) console.log(
        `[SubscriptionContext] Loaded — tier: ${data.tier} | STT: ${data.transcription_seconds_used}s | TTS: ${data.tts_characters_used} chars | OCR: ${data.ocr_pages_used} pages | Research: ${data.research_queries_used} queries`
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
