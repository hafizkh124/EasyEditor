import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

export type DisplayCurrency = "PKR" | "USD";

/**
 * Returns the currency to show in pricing UI.
 * - Logged-in users with country = Pakistan → PKR
 * - Logged-in users with another country → USD
 * - Anonymous users: Urdu UI → PKR, otherwise USD
 */
export function useDisplayCurrency(): DisplayCurrency {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setCountry(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("country")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCountry((data?.country ?? "").trim() || null);
      });
    return () => { cancelled = true; };
  }, [user]);

  if (user) {
    if (!country) return language === "ur" ? "PKR" : "USD";
    return /pakistan|پاکستان/i.test(country) ? "PKR" : "USD";
  }
  return language === "ur" ? "PKR" : "USD";
}
