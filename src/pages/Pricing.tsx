import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useSeo } from "@/hooks/useSeo";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, Zap, Star } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { motion } from "framer-motion";

import { PLAN_TIERS, buildFeatures, type PaidTier } from "@/lib/planTiers";
import { useDisplayCurrency } from "@/hooks/useDisplayCurrency";
import { PlanCard, type PricingPlan } from "@/components/pricing/PlanCard";
import { UpgradeDialog } from "@/components/pricing/UpgradeDialog";

const TIER_ORDER: Record<string, number> = { free: 0, basic: 1, pro: 2, ultra: 3 };

/** UI-only styling per tier — the data itself comes from shared PLAN_TIERS. */
const PLAN_STYLE: Record<PaidTier, Pick<PricingPlan, "icon" | "iconClass" | "bgClass" | "cardBorder" | "gradient">> = {
  basic: { icon: Zap, iconClass: "text-blue-500", bgClass: "bg-blue-500/10", cardBorder: "border-blue-200/60 dark:border-blue-800/40", gradient: "from-blue-500/5 via-transparent to-blue-500/5" },
  pro:   { icon: Crown, iconClass: "text-primary", bgClass: "bg-primary/15", cardBorder: "border-primary/40 shadow-md", gradient: "from-primary/5 via-transparent to-primary/5" },
  ultra: { icon: Star, iconClass: "text-purple-500", bgClass: "bg-purple-500/10", cardBorder: "border-purple-300/50 dark:border-purple-700/40 opacity-80", gradient: "from-purple-500/5 via-transparent to-purple-500/5" },
};

const Pricing = () => {
  useSeo({ title: "Pricing — Al-Ulama Easy Editor", description: "Compare Basic, Pro and Ultra plans for Al-Ulama Easy Editor and pick what fits you.", path: "/pricing", noindex: true });

  const { user } = useAuth();
  const { t, direction, language } = useLanguage();
  const { subscription, loading, refetch } = useSubscription();
  const currency = useDisplayCurrency();
  const currentTier = subscription?.tier ?? "free";

  const [upgradeRequested, setUpgradeRequested] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPlan, setDialogPlan] = useState<PaidTier>("basic");
  const [txId, setTxId] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchParams] = useSearchParams();
  const isExpiredFlow = searchParams.get("expired") === "true";
  // Renewal = user already has a paid tier with an activation date on file.
  const isRenewal = currentTier !== "free" && !!subscription?.activated_at;

  useEffect(() => {
    if (subscription) setUpgradeRequested(subscription.upgrade_requested ?? false);
  }, [subscription]);

  const openDialog = (plan: PaidTier) => {
    setDialogPlan(plan);
    setTxId("");
    setReceiptFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setDialogOpen(true);
  };

  const submitUpgradeRequest = async () => {
    if (!user || !txId.trim() || !receiptFile) return;
    if (receiptFile.size > 5 * 1024 * 1024) {
      toast.error(t("toast.upload.image_too_large"));
      return;
    }
    setSubmitting(true);
    try {
      // 1. Upload receipt to private storage bucket
      const ext = (receiptFile.name.split(".").pop() || "jpg").toLowerCase();
      const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("payment-receipts")
        .upload(storagePath, receiptFile, { contentType: receiptFile.type, upsert: false });
      if (upErr) throw new Error(upErr.message);

      // 2. Submit to verification endpoint — renewal endpoint for already-active users
      const fnName = isRenewal ? "verify-renewal-receipt" : "verify-receipt";
      const fnBody = isRenewal
        ? { referenceNo: txId.trim(), storagePath }
        : { planId: dialogPlan, referenceNo: txId.trim(), storagePath };
      const { data, error: fnErr } = await supabase.functions.invoke(fnName, { body: fnBody });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(String(data.error));

      if (data?.autoApproved) {
        toast.success(t("toast.account.activated"));
        setDialogOpen(false);
        await refetch();
        setTimeout(() => { window.location.href = "/dashboard"; }, 800);
      } else {
        setUpgradeRequested(true);
        setDialogOpen(false);
        toast.success(t("toast.account.receipt_sent"));
        await refetch();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg || t("pricing.request_error"));
    } finally {
      setSubmitting(false);
    }
  };

  const plans: PricingPlan[] = PLAN_TIERS.map((tier) => ({
    ...tier,
    ...PLAN_STYLE[tier.id],
    features: buildFeatures(tier.featureTemplates, t),
  }));

  const selectedPlan = plans.find((p) => p.id === dialogPlan)!;

  if (loading) {
    return (
      <AppLayout>
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-10" dir={direction} aria-busy="true" aria-live="polite">
          <div className="space-y-3 text-center">
            {/* w-96 is 384px — wider than a 375px viewport, so the loading
                state overflowed horizontally before the page even rendered. */}
            <Skeleton className="h-9 w-full max-w-xs mx-auto" />
            <Skeleton className="h-4 w-full max-w-sm mx-auto" />
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader className="space-y-3">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-10 w-full rounded-xl" />
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-10" dir={direction}>
        {isExpiredFlow && (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-900 dark:text-red-200">
            {t("pricing.lapsed_notice", language === "ur"
              ? "آپ کی سبسکرپشن ختم ہو چکی ہے۔ Renew کرنے کے لیے اپنے موجودہ پلان پر receipt اپلوڈ کریں۔"
              : "Your subscription has lapsed. Upload a renewal receipt for your current plan to restore access.")}
          </div>
        )}

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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {plans.map((plan, index) => {
            const above = TIER_ORDER[plan.id] > TIER_ORDER[currentTier];
            return (
              <PlanCard
                key={plan.id}
                plan={plan}
                index={index}
                isCurrent={currentTier === plan.id}
                isBelowCurrent={TIER_ORDER[plan.id] < TIER_ORDER[currentTier]}
                isPending={upgradeRequested && subscription?.pending_tier === plan.id}
                showRequest={above && !upgradeRequested && !plan.comingSoon}
                currency={currency}
                language={language}
                t={t}
                onRequest={openDialog}
              />
            );
          })}
        </div>
      </div>

      <UpgradeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        plan={selectedPlan}
        direction={direction}
        language={language}
        t={t}
        txId={txId}
        onTxIdChange={setTxId}
        receiptFile={receiptFile}
        onReceiptChange={setReceiptFile}
        fileInputRef={fileInputRef}
        submitting={submitting}
        onSubmit={submitUpgradeRequest}
      />
    </AppLayout>
  );
};

export default Pricing;
