import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type SafepaySubscriptionTier = "basic" | "pro" | "ultra";
export type SafepayTopupKey = "small" | "medium" | "large";

interface SubscriptionArgs {
  kind: "subscription";
  tier: SafepaySubscriptionTier;
}
interface TopupArgs {
  kind: "topup";
  topupKey: SafepayTopupKey;
}
type OpenCheckoutArgs = SubscriptionArgs | TopupArgs;

/** SafePay hosted-checkout launcher. Calls the safepay-checkout edge function
 *  and redirects the browser to the returned hosted URL. */
export function useSafepayCheckout() {
  const [loading, setLoading] = useState(false);

  const openCheckout = async (args: OpenCheckoutArgs) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("safepay-checkout", {
        body: { ...args, origin: window.location.origin },
      });
      if (error) throw error;
      if (!data?.checkoutUrl) throw new Error("No checkout URL returned");
      window.location.href = data.checkoutUrl;
    } catch (e) {
      console.error("[safepay-checkout] failed:", e);
      toast.error(e instanceof Error ? e.message : "Could not open checkout");
      setLoading(false);
    }
  };

  return { openCheckout, loading };
}

/** SafePay is configured when the public client knows it's enabled.
 *  We treat it as always enabled here — backend will reject if keys missing. */
export const isSafepayEnabled = () => true;
