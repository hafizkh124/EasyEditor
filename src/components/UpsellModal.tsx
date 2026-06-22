import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { Coins, ArrowUpCircle } from "lucide-react";

/**
 * UpsellModal — shown when user's tokens are low.
 * Two options: upgrade plan or manual top-up request (admin-approved).
 */

export default function UpsellModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { toast } = useToast();

  const [view, setView] = useState<"main" | "manual">("main");
  const [tokenAmount, setTokenAmount] = useState(2500);
  const [paymentRef, setPaymentRef] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const pkrCost = (tokenAmount * 0.25).toLocaleString();

  const reset = () => {
    setView("main");
    setTokenAmount(2500);
    setPaymentRef("");
  };

  const handleManualTopup = async () => {
    if (!user) return;
    if (tokenAmount < 2500) {
      toast({ title: t("tokens.min_topup_error") || "Minimum top-up is 2,500 tokens", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("topup_requests").insert({
      user_id: user.id,
      token_amount: tokenAmount,
      pkr_amount: tokenAmount * 0.25,
      payment_reference: paymentRef || null,
      status: "pending",
    });
    if (error) {
      toast({ title: t("tokens.topup_error") || "Failed to submit top-up request", variant: "destructive" });
    } else {
      toast({ title: t("tokens.topup_submitted") || "Top-up request submitted! Awaiting admin approval." });
      onOpenChange(false);
      reset();
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-amber-500" />
            {t("tokens.low_balance_title") || "Low Token Balance"}
          </DialogTitle>
          <DialogDescription>
            {t("tokens.low_balance_desc") || "Your tokens are running low. Upgrade your plan or top up to continue."}
          </DialogDescription>
        </DialogHeader>

        {view === "main" && (
          <div className="space-y-3 py-2">
            <Button asChild className="w-full" variant="default">
              <Link to="/pricing" onClick={() => onOpenChange(false)}>
                <ArrowUpCircle className="h-4 w-4 me-2" />
                {t("tokens.upgrade_plan") || "Upgrade Plan"}
              </Link>
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setView("manual")}>
              <Coins className="h-4 w-4 me-2" />
              {t("tokens.request_topup") || "Manual top-up (PKR)"}
            </Button>
          </div>
        )}


        {view === "manual" && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="topup-amount">
                {t("tokens.topup_amount") || "Token Amount"} ({t("tokens.min") || "min"}: 2,500)
              </Label>
              <Input
                id="topup-amount"
                type="number"
                min={2500}
                step={500}
                value={tokenAmount}
                onChange={(e) => setTokenAmount(Math.max(0, parseInt(e.target.value) || 0))}
              />
              <p className="text-xs text-muted-foreground">
                {t("tokens.cost") || "Cost"}: PKR {pkrCost} (0.25 PKR/{t("tokens.per_token") || "token"})
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-ref">
                {t("tokens.payment_reference") || "Payment Reference"} ({t("tokens.optional") || "optional"})
              </Label>
              <Input
                id="payment-ref"
                placeholder={t("tokens.payment_ref_placeholder") || "e.g. JazzCash TXN #12345"}
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
              />
            </div>
            <DialogFooter className="flex gap-2">
              <Button variant="ghost" onClick={() => setView("main")}>
                {t("common.back") || "Back"}
              </Button>
              <Button onClick={handleManualTopup} disabled={submitting || tokenAmount < 2500}>
                {submitting
                  ? (t("common.submitting") || "Submitting...")
                  : (t("tokens.submit_request") || "Submit Request")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
