import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, X, Crown, Zap, Loader2, Star, Clock } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { motion } from "framer-motion";

const MotionCard = motion(Card);

type PaidTier = "basic" | "pro" | "ultra";

const TIER_ORDER: Record<string, number> = { free: 0, basic: 1, pro: 2, ultra: 3 };

const Pricing = () => {
  const { user } = useAuth();
  const { t, direction } = useLanguage();
  const { subscription, loading, refetch } = useSubscription();
  const currentTier = subscription?.tier ?? "free";

  const [upgradeRequested, setUpgradeRequested] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPlan, setDialogPlan] = useState<PaidTier>("basic");
  const [txId, setTxId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (subscription) {
      setUpgradeRequested(subscription.upgrade_requested ?? false);
    }
  }, [subscription]);

  const openDialog = (plan: PaidTier) => {
    setDialogPlan(plan);
    setTxId("");
    setDialogOpen(true);
  };

  const submitUpgradeRequest = async () => {
    if (!user || !txId.trim()) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("subscriptions")
      .update({
        upgrade_requested: true,
        pending_tier: dialogPlan,
        payment_reference: txId.trim(),
        last_upgrade_request: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (error) {
      toast.error(t("pricing.request_error"));
    } else {
      setUpgradeRequested(true);
      setDialogOpen(false);
      setTxId("");
      toast.success(t("pricing.request_submitted"));
      refetch();
    }
    setSubmitting(false);
  };

  // Plan definitions — features listed with inclusion status
  const plans = [
    {
      id: "basic" as PaidTier,
      nameKey: "settings.basic",
      price: "1,000 PKR",
      priceAmountKey: "pricing.payment_amount_basic",
      icon: Zap,
      iconClass: "text-blue-500",
      bgClass: "bg-blue-500/10",
      cardBorder: "border-blue-200/60 dark:border-blue-800/40",
      gradient: "from-blue-500/5 via-transparent to-blue-500/5",
      popular: false,
      features: [
        { label: `1,800 ${t("pricing.seconds")}`, key: "pricing.stt", included: true },
        { label: `50,000 ${t("pricing.characters")}`, key: "pricing.tts", included: true },
        { label: `30 ${t("pricing.pages")}`, key: "pricing.ocr", included: true },
        { label: `20 ${t("pricing.queries")}`, key: "pricing.research", included: true },
        { label: t("pricing.voice_clone"), key: "pricing.voice_clone", included: true },
        { label: t("pricing.priority_support"), key: "pricing.priority_support", included: false },
      ],
    },
    {
      id: "pro" as PaidTier,
      nameKey: "settings.pro",
      price: "4,000 PKR",
      priceAmountKey: "pricing.payment_amount_pro",
      icon: Crown,
      iconClass: "text-primary",
      bgClass: "bg-primary/15",
      cardBorder: "border-primary/40 shadow-md",
      gradient: "from-primary/5 via-transparent to-primary/5",
      popular: true,
      features: [
        { label: `18,000 ${t("pricing.seconds")}`, key: "pricing.stt", included: true },
        { label: `500,000 ${t("pricing.characters")}`, key: "pricing.tts", included: true },
        { label: `300 ${t("pricing.pages")}`, key: "pricing.ocr", included: true },
        { label: `200 ${t("pricing.queries")}`, key: "pricing.research", included: true },
        { label: t("pricing.voice_clone"), key: "pricing.voice_clone", included: true },
        { label: t("pricing.priority_support"), key: "pricing.priority_support", included: true },
      ],
    },
    {
      id: "ultra" as PaidTier,
      nameKey: "settings.ultra",
      price: "7,000 PKR",
      priceAmountKey: "pricing.payment_amount_ultra",
      icon: Star,
      iconClass: "text-purple-500",
      bgClass: "bg-purple-500/10",
      cardBorder: "border-purple-300/50 dark:border-purple-700/40",
      gradient: "from-purple-500/5 via-transparent to-purple-500/5",
      popular: false,
      features: [
        { label: `${t("pricing.unlimited")} ${t("pricing.stt")}`, key: "pricing.stt", included: true },
        { label: `${t("pricing.unlimited")} ${t("pricing.tts")}`, key: "pricing.tts", included: true },
        { label: `5,000 ${t("pricing.pages")}`, key: "pricing.ocr", included: true },
        { label: `1,000 ${t("pricing.queries")}`, key: "pricing.research", included: true },
        { label: t("pricing.voice_clone"), key: "pricing.voice_clone", included: true },
        { label: t("pricing.priority_support"), key: "pricing.priority_support", included: true },
      ],
    },
  ];

  const isCurrent = (planId: PaidTier) => currentTier === planId;
  const isBelowCurrent = (planId: PaidTier) => TIER_ORDER[planId] < TIER_ORDER[currentTier];
  const isAboveCurrent = (planId: PaidTier) => TIER_ORDER[planId] > TIER_ORDER[currentTier];
  const isPendingFor = (planId: PaidTier) =>
    upgradeRequested && subscription?.pending_tier === planId;

  const selectedPlan = plans.find((p) => p.id === dialogPlan)!;

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-10" dir={direction}>

        {/* Header */}
        <motion.div
          className="text-center space-y-3"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex justify-center mb-4">
            <motion.div
              className="rounded-full bg-primary/10 p-4"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Crown className="h-8 w-8 text-primary" />
            </motion.div>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
            {t("pricing.title")}
          </h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">
            {t("pricing.subtitle")}
          </p>
        </motion.div>

        {/* Plan cards — 3 columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {plans.map((plan, index) => {
            const Icon = plan.icon;
            const current = isCurrent(plan.id);
            const below = isBelowCurrent(plan.id);
            const above = isAboveCurrent(plan.id);
            const pendingThis = isPendingFor(plan.id);
            // Request button is shown only when above current and no pending request exists
            const showRequest = above && !upgradeRequested;

            return (
              <MotionCard
                key={plan.id}
                className={`relative overflow-hidden transition-shadow duration-300 hover:shadow-lg ${
                  current
                    ? "border-primary ring-2 ring-primary/30 shadow-lg"
                    : plan.cardBorder
                } ${below ? "opacity-50" : ""}`}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: below ? 0.5 : 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 + index * 0.1 }}
              >
                {/* Popular ribbon */}
                {plan.popular && !current && !below && (
                  <motion.div
                    className="absolute top-0 inset-x-0 flex justify-center"
                    initial={{ y: -30 }}
                    animate={{ y: 0 }}
                    transition={{ delay: 0.5, type: "spring" }}
                  >
                    <span className="bg-primary text-primary-foreground text-xs font-semibold px-4 py-1 rounded-b-lg">
                      ⭐ {t("pricing.recommended")}
                    </span>
                  </motion.div>
                )}

                {/* Subtle gradient */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${plan.gradient} pointer-events-none`}
                />

                <CardHeader className={`text-center pb-4 relative ${plan.popular ? "pt-10" : "pt-8"}`}>
                  <motion.div
                    className="flex justify-center mb-3"
                    whileHover={{ rotate: plan.id === "pro" ? -15 : 15, scale: 1.1 }}
                    transition={{ type: "spring", stiffness: 300 }}
                  >
                    <div className={`rounded-2xl ${plan.bgClass} p-4`}>
                      <Icon className={`h-7 w-7 ${plan.iconClass}`} />
                    </div>
                  </motion.div>

                  <CardTitle className="text-xl">{t(plan.nameKey)}</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                    <span className="text-sm text-muted-foreground"> / {t("pricing.per_month")}</span>
                  </div>

                  {current && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring" }}
                    >
                      <Badge className="mt-2 text-xs px-3 py-1">{t("pricing.current")}</Badge>
                    </motion.div>
                  )}
                </CardHeader>

                <CardContent className="space-y-0.5 pb-8 relative">
                  {/* Feature rows */}
                  {plan.features.map((f, i) => (
                    <motion.div
                      key={f.key + f.label}
                      className={`flex items-center gap-2.5 text-sm rounded-lg px-2.5 py-2 transition-colors ${
                        f.included ? "hover:bg-accent/50" : "opacity-40"
                      }`}
                      initial={{ opacity: 0, x: -15 }}
                      animate={{ opacity: f.included ? 1 : 0.4, x: 0 }}
                      transition={{ delay: 0.25 + i * 0.06 }}
                    >
                      <div
                        className={`rounded-full p-1 flex-shrink-0 ${
                          f.included ? plan.bgClass : "bg-muted"
                        }`}
                      >
                        {f.included ? (
                          <Check className={`h-3 w-3 ${plan.iconClass}`} />
                        ) : (
                          <X className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                      <span
                        className={
                          f.included
                            ? "text-foreground font-medium"
                            : "text-muted-foreground line-through"
                        }
                      >
                        {f.label}
                      </span>
                    </motion.div>
                  ))}

                  {/* CTA area */}
                  {(showRequest || pendingThis) && (
                    <motion.div
                      className="pt-5"
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.6 }}
                    >
                      {pendingThis ? (
                        /* Pending badge */
                        <div className="rounded-xl border border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-center space-y-1">
                          <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-medium">
                            <Clock className="h-4 w-4" />
                            {t("pricing.pending_approval")}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("pricing.pending_approval_desc")}
                          </p>
                        </div>
                      ) : (
                        /* Request button */
                        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                          <Button
                            onClick={() => openDialog(plan.id)}
                            className="w-full h-11 rounded-xl"
                            variant={plan.id === "ultra" ? "outline" : "default"}
                          >
                            <Icon className="h-4 w-4 me-2" />
                            {t("pricing.request_upgrade")}
                          </Button>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </CardContent>
              </MotionCard>
            );
          })}
        </div>

        <p className="text-xs text-center text-muted-foreground">
          {t("pricing.admin_approval_note")}
        </p>
      </div>

      {/* Payment Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md" dir={direction}>
          <DialogHeader>
            <DialogTitle>
              {t("pricing.payment_dialog_title")} — {t(selectedPlan.nameKey)}
            </DialogTitle>
            <DialogDescription>{t("pricing.payment_dialog_desc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Bank Transfer */}
            <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t("pricing.payment_bank_label")}
              </p>
              <p className="text-sm font-medium">{t("pricing.payment_bank_details")}</p>
            </div>

            {/* EasyPaisa / JazzCash */}
            <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t("pricing.payment_easypaisa_label")}
              </p>
              <p className="text-sm font-medium">{t("pricing.payment_easypaisa_details")}</p>
            </div>

            {/* Dynamic amount */}
            <p className="text-sm font-semibold text-primary">
              {t(selectedPlan.priceAmountKey)}
            </p>

            {/* Transaction ID */}
            <div className="space-y-1.5">
              <Label htmlFor="txId">{t("pricing.transaction_id_label")}</Label>
              <Input
                id="txId"
                placeholder={t("pricing.transaction_id_placeholder")}
                value={txId}
                onChange={(e) => setTxId(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && !submitting && txId.trim() && submitUpgradeRequest()
                }
              />
            </div>

            <p className="text-xs text-muted-foreground">{t("pricing.payment_note")}</p>

            <Button
              onClick={submitUpgradeRequest}
              disabled={submitting || !txId.trim()}
              className="w-full"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin me-2" />
              ) : (
                <Crown className="h-4 w-4 me-2" />
              )}
              {t("pricing.submit_payment")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Pricing;
