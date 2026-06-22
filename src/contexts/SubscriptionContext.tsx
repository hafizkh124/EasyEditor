import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { handleSupabaseError } from "@/lib/errors";
import type { Tables } from "@/integrations/supabase/types";

type Subscription = Tables<"subscriptions">;

/** Token wallet from `token_wallets` table */
export interface TokenWallet {
  monthly_balance: number;
  topup_balance: number;
  monthly_limit: number;
}

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
    islamic_queries_limit: 0,
  },
  basic: {
    transcription_limit: 1_800,    // 30 minutes
    tts_character_limit: 0,        // TTS not included (Ultra only)
    ocr_pages_limit: 30,
    research_queries_limit: 20,
    islamic_queries_limit: 10,     // Tier A APIs only (Dorar, AlQuran, Sunnah, Quran.com)
  },
  pro: {
    transcription_limit: 18_000,   // 5 hours
    tts_character_limit: 0,        // TTS not included (Ultra only)
    ocr_pages_limit: 300,
    research_queries_limit: 200,
    islamic_queries_limit: 100,    // Tier A + B (vector index) + C (scraping)
  },
  ultra: {
    transcription_limit: 36_000,   // 10 hours — reserved for future launch
    tts_character_limit: 500_000,
    ocr_pages_limit: 2_000,
    research_queries_limit: 500,
    islamic_queries_limit: 500,    // All tiers + top-20 vector results
  },
} as const;

/** Monthly token allocation per tier (mirrors server-side tokenGuard.ts) */
export const TOKEN_ALLOCATIONS: Record<string, number> = {
  free:  0,
  basic: 5_000,
  pro:   25_000,
  ultra: 50_000,
} as const;

/** Token cost per unit for each action (mirrors server-side TOKEN_COSTS) */
export const TOKEN_COSTS = {
  stt:            10,    // per minute of audio
  ocr:            15,    // per page
  research:       30,    // per query
  islamic:        40,    // per query
  tts_google:     50,    // per 1K characters
  tts_elevenlabs: 500,   // per 1K characters
  refine:         5,     // per refinement action
  translate:      20,    // per page/segment translated
} as const;

export type TokenActionType = keyof typeof TOKEN_COSTS;

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 7;

interface SubscriptionContextType {
  subscription: Subscription | null;
  tokenWallet: TokenWallet | null;
  loading: boolean;
  /** True when expires_at is in the past (any user with an expiry date). */
  isExpired: boolean;
  /** True when expires_at + 7 days is also in the past — feature access should be blocked. */
  isLapsed: boolean;
  /** Days left in the grace period (0–7). Null when not in grace. */
  daysUntilLapse: number | null;
  refetch: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType>({
  subscription: null,
  tokenWallet: null,
  loading: true,
  isExpired: false,
  isLapsed: false,
  daysUntilLapse: null,
  refetch: async () => {},
});

export const useSubscription = () => useContext(SubscriptionContext);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [tokenWallet, setTokenWallet] = useState<TokenWallet | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setSubscription(null);
      setTokenWallet(null);
      setLoading(false);
      return;
    }
    if (import.meta.env.DEV) console.log("[SubscriptionContext] Fetching subscription for user:", user.id);
    setLoading(true);

    // Fetch subscription and token wallet in parallel
    const [subResult, walletResult] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("token_wallets")
        .select("monthly_balance, topup_balance, monthly_limit")
        .eq("user_id", user.id)
        .single(),
    ]);

    if (subResult.error) {
      handleSupabaseError(subResult.error, "load subscription");
    } else {
      if (import.meta.env.DEV) console.log(
        `[SubscriptionContext] Loaded — tier: ${subResult.data.tier} | STT: ${subResult.data.transcription_seconds_used}s | TTS: ${subResult.data.tts_characters_used} chars | OCR: ${subResult.data.ocr_pages_used} pages | Research: ${subResult.data.research_queries_used} queries`
      );
      setSubscription(subResult.data);
    }

    if (walletResult.error) {
      // Wallet may not exist for very old users — not fatal
      if (import.meta.env.DEV) console.warn("[SubscriptionContext] Token wallet not found:", walletResult.error.message);
      setTokenWallet(null);
    } else {
      const w = walletResult.data;
      if (import.meta.env.DEV) console.log(
        `[SubscriptionContext] Wallet — monthly: ${w.monthly_balance}/${w.monthly_limit} | topup: ${w.topup_balance} | total: ${w.monthly_balance + w.topup_balance}`
      );
      setTokenWallet(w);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const { isExpired, isLapsed, daysUntilLapse } = useMemo(() => {
    const expiresAtStr = (subscription as { expires_at?: string | null } | null)?.expires_at;
    if (!expiresAtStr) {
      return { isExpired: false, isLapsed: false, daysUntilLapse: null as number | null };
    }
    const expiresAt = new Date(expiresAtStr).getTime();
    const now = Date.now();
    const expired = now > expiresAt;
    if (!expired) {
      return { isExpired: false, isLapsed: false, daysUntilLapse: null as number | null };
    }
    const daysSinceExpiry = Math.floor((now - expiresAt) / DAY_MS);
    const remaining = GRACE_DAYS - daysSinceExpiry;
    const lapsed = remaining <= 0;
    return {
      isExpired: true,
      isLapsed: lapsed,
      daysUntilLapse: lapsed ? 0 : Math.max(0, remaining),
    };
  }, [subscription]);

  const value = useMemo(
    () => ({ subscription, tokenWallet, loading, isExpired, isLapsed, daysUntilLapse, refetch: fetchSubscription }),
    [subscription, tokenWallet, loading, isExpired, isLapsed, daysUntilLapse, fetchSubscription]
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};
