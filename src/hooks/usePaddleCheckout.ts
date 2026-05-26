import { useState } from "react";
import { initializePaddle, getPaddlePriceId, isPaddleConfigured } from "@/lib/paddle";
import { toast } from "sonner";

interface OpenCheckoutOptions {
  priceId: string;
  customerEmail?: string;
  userId: string;
  successUrl?: string;
}

export function usePaddleCheckout() {
  const [loading, setLoading] = useState(false);

  const openCheckout = async (opts: OpenCheckoutOptions) => {
    if (!isPaddleConfigured()) {
      toast.error("Card payments are not configured yet.");
      return;
    }
    setLoading(true);
    try {
      await initializePaddle();
      const paddlePriceId = await getPaddlePriceId(opts.priceId);
      window.Paddle.Checkout.open({
        items: [{ priceId: paddlePriceId, quantity: 1 }],
        customer: opts.customerEmail ? { email: opts.customerEmail } : undefined,
        customData: { userId: opts.userId },
        settings: {
          displayMode: "overlay",
          successUrl: opts.successUrl || `${window.location.origin}/checkout/success`,
          allowLogout: false,
          variant: "one-page",
        },
      });
    } catch (e) {
      console.error("[checkout] failed to open:", e);
      toast.error(e instanceof Error ? e.message : "Could not open checkout");
    } finally {
      setLoading(false);
    }
  };

  return { openCheckout, loading };
}
