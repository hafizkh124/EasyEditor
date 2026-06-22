import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useSeo } from "@/hooks/useSeo";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Check, X, Crown, Zap, Loader2, Star, Clock, Construction, MessageCircle, Copy } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { motion } from "framer-motion";

import { PLAN_TIERS, buildFeatures, type PaidTier } from "@/lib/planTiers";

const MotionCard = motion(Card);

const TIER_ORDER: Record<string, number> = { free: 0, basic: 1, pro: 2, ultra: 3 };

const copyToClipboard = async (value: string, copiedLabel: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(copiedLabel);
  } catch {
    toast.error("Copy failed");
  }
};

interface CopyValueProps {
  value: string;
  mono?: boolean;
  small?: boolean;
  label: string;
  copyLabel: string;
  copiedLabel: string;
}

const CopyValue = ({ value, mono, small, label, copyLabel, copiedLabel }: CopyValueProps) => (
  <div className="flex items-center gap-2 min-w-0" dir="ltr">
    <span className={`font-medium break-all ${mono ? "font-mono" : ""} ${small ? "text-xs" : ""}`}>
      {value}
    </span>
    <button
      type="button"
      onClick={() => copyToClipboard(value, copiedLabel)}
      aria-label={`${copyLabel} ${label}`}
      className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  </div>
);

interface PhoneValueProps {
  display: string;
  raw: string;
  wa?: string;
  copyLabel: string;
  copiedLabel: string;
  waLabel?: string;
}

const PhoneValue = ({ display, raw, wa, copyLabel, copiedLabel, waLabel }: PhoneValueProps) => (
  <div className="flex items-center gap-2 min-w-0 flex-wrap" dir="ltr">
    <a
      href={`tel:${raw}`}
      className="font-mono font-medium text-primary underline-offset-2 hover:underline"
    >
      {display}
    </a>
    <button
      type="button"
      onClick={() => copyToClipboard(raw, copiedLabel)}
      aria-label={`${copyLabel} ${display}`}
      className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
    {wa && (
      <a
        href={`https://wa.me/${wa}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={waLabel ?? "WhatsApp"}
        className="flex-shrink-0 rounded-md p-1.5 text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <MessageCircle className="h-3.5 w-3.5" />
      </a>
    )}
  </div>
);


const Pricing = () => {
  useSeo({ title: "Pricing — Al-Ulama Easy Editor", description: "Compare Basic, Pro and Ultra plans for Al-Ulama Easy Editor and pick what fits you.", path: "/pricing" });

  const { user } = useAuth();
  const { t, direction, language } = useLanguage();
  const { subscription, loading, refetch } = useSubscription();
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
    if (subscription) {
      setUpgradeRequested(subscription.upgrade_requested ?? false);
    }
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
      toast.error(language === "ur" ? "تصویر 5MB سے کم ہونی چاہیے" : "Image must be smaller than 5MB");
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

      // 2. Invoke AI verifier — renewal endpoint for already-active users
      const fnName = isRenewal ? "verify-renewal-receipt" : "verify-receipt";
      const fnBody = isRenewal
        ? { referenceNo: txId.trim(), storagePath }
        : { planId: dialogPlan, referenceNo: txId.trim(), storagePath };
      const { data, error: fnErr } = await supabase.functions.invoke(fnName, { body: fnBody });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(String(data.error));

      if (data?.autoApproved) {
        toast.success(language === "ur"
          ? "آپ کا اکاؤنٹ فوری طور پر فعال ہو گیا!"
          : "Your account is now active!");
        setDialogOpen(false);
        await refetch();
        setTimeout(() => { window.location.href = "/dashboard"; }, 800);
      } else {
        setUpgradeRequested(true);
        setDialogOpen(false);
        toast.success(language === "ur"
          ? "آپ کی receipt admin کو review کے لیے بھیج دی گئی ہے۔"
          : "Receipt sent to admin for review.");
        await refetch();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg || t("pricing.request_error"));
    } finally {
      setSubmitting(false);
    }
  };

  /** UI-only styling per tier — data comes from shared PLAN_TIERS */
  const PLAN_STYLE: Record<PaidTier, { icon: typeof Zap; iconClass: string; bgClass: string; cardBorder: string; gradient: string }> = {
    basic: { icon: Zap, iconClass: "text-blue-500", bgClass: "bg-blue-500/10", cardBorder: "border-blue-200/60 dark:border-blue-800/40", gradient: "from-blue-500/5 via-transparent to-blue-500/5" },
    pro:   { icon: Crown, iconClass: "text-primary", bgClass: "bg-primary/15", cardBorder: "border-primary/40 shadow-md", gradient: "from-primary/5 via-transparent to-primary/5" },
    ultra: { icon: Star, iconClass: "text-purple-500", bgClass: "bg-purple-500/10", cardBorder: "border-purple-300/50 dark:border-purple-700/40 opacity-80", gradient: "from-purple-500/5 via-transparent to-purple-500/5" },
  };

  const plans = PLAN_TIERS.map((tier) => ({
    ...tier,
    ...PLAN_STYLE[tier.id],
    features: buildFeatures(tier.featureTemplates, t),
  }));

  const isCurrent    = (id: PaidTier) => currentTier === id;
  const isBelowCurrent = (id: PaidTier) => TIER_ORDER[id] < TIER_ORDER[currentTier];
  const isAboveCurrent = (id: PaidTier) => TIER_ORDER[id] > TIER_ORDER[currentTier];
  const isPendingFor = (id: PaidTier) =>
    upgradeRequested && subscription?.pending_tier === id;

  const selectedPlan = plans.find((p) => p.id === dialogPlan)!;

  if (loading) {
    return (
      <AppLayout>
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-10" dir={direction} aria-busy="true" aria-live="polite">
          <div className="space-y-3 text-center">
            <Skeleton className="h-9 w-72 mx-auto" />
            <Skeleton className="h-4 w-96 mx-auto" />
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader className="space-y-3">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-9 w-20" />
                </CardHeader>
                <CardContent className="space-y-3">
                  {[0, 1, 2, 3, 4].map((j) => (
                    <Skeleton key={j} className="h-3 w-full" />
                  ))}
                  <Skeleton className="h-9 w-full mt-4" />
                </CardContent>
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
            const current     = isCurrent(plan.id);
            const below       = isBelowCurrent(plan.id);
            const above       = isAboveCurrent(plan.id);
            const pendingThis = isPendingFor(plan.id);
            // Show request button only when above current, no pending request, and NOT coming soon
            const showRequest = above && !upgradeRequested && !plan.comingSoon;

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

                {/* Coming Soon ribbon (Ultra) */}
                {plan.comingSoon && (
                  <motion.div
                    className="absolute top-0 inset-x-0 flex justify-center"
                    initial={{ y: -30 }}
                    animate={{ y: 0 }}
                    transition={{ delay: 0.5, type: "spring" }}
                  >
                    <span className="flex items-center gap-1.5 bg-amber-500 text-white text-xs font-semibold px-4 py-1 rounded-b-lg">
                      <Construction className="h-3 w-3" />
                      {t("pricing.coming_soon")}
                    </span>
                  </motion.div>
                )}

                {/* Subtle gradient overlay */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${plan.gradient} pointer-events-none`}
                />

                <CardHeader
                  className={`text-center pb-4 relative ${plan.popular ? "pt-10" : "pt-8"}`}
                >
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
                  <div className="mt-2 space-y-1">
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-3xl font-bold text-primary">{plan.cardPrice}</span>
                      <span className="text-sm text-muted-foreground">/ {t("pricing.per_month")}</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <Zap className="h-3 w-3" /> Card · instant activation
                    </div>
                    <div className="text-xs text-muted-foreground pt-1">
                      or {plan.price} <span className="opacity-70">· manual, 1–2 days</span>
                    </div>
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
                      key={f.label}
                      className={`flex items-center gap-2.5 text-sm rounded-lg px-2.5 py-2 transition-colors ${
                        f.included ? "hover:bg-accent/50" : f.comingSoon ? "" : "opacity-50"
                      }`}
                      initial={{ opacity: 0, x: -15 }}
                      animate={{ opacity: f.included || f.comingSoon ? 1 : 0.5, x: 0 }}
                      transition={{ delay: 0.25 + i * 0.06 }}
                    >
                      <div
                        className={`rounded-full p-1 flex-shrink-0 ${
                          f.included ? plan.bgClass : "bg-muted"
                        }`}
                      >
                        {f.included ? (
                          <Check className={`h-3 w-3 ${plan.iconClass}`} />
                        ) : f.comingSoon ? (
                          <Clock className="h-3 w-3 text-amber-500" />
                        ) : (
                          <X className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                      <span
                        className={
                          f.included
                            ? "text-foreground font-medium"
                            : f.comingSoon
                              ? "text-foreground/80"
                              : "text-muted-foreground line-through"
                        }
                      >
                        {f.label}
                      </span>
                      {f.comingSoon && (
                        <Badge variant="outline" className="ms-auto text-[10px] py-0 px-1.5 border-amber-400/60 text-amber-600 dark:text-amber-400">
                          {t("pricing.coming_soon")}
                        </Badge>
                      )}
                    </motion.div>
                  ))}

                  {/* CTA */}
                  <motion.div
                    className="pt-5"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                  >
                    {plan.comingSoon ? (
                      /* Ultra — Coming Soon: disabled Notify Me button */
                      <Button
                        disabled
                        className="w-full h-11 rounded-xl"
                        variant="outline"
                      >
                        <Construction className="h-4 w-4 me-2 text-amber-500" />
                        {t("pricing.notify_me")}
                      </Button>
                    ) : pendingThis ? (
                      /* Pending approval badge */
                      <div className="rounded-xl border border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-center space-y-1">
                        <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-medium">
                          <Clock className="h-4 w-4" />
                          {t("pricing.pending_approval")}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("pricing.pending_approval_desc")}
                        </p>
                      </div>
                    ) : showRequest ? (
                      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                        <Button
                          onClick={() => openDialog(plan.id)}
                          className="w-full h-11 rounded-xl"
                        >
                          <Icon className="h-4 w-4 me-2" />
                          {language === "ur" ? `${t(plan.nameKey)} حاصل کریں` : `Get ${t(plan.nameKey)}`}
                        </Button>
                      </motion.div>
                    ) : null}
                  </motion.div>
                </CardContent>
              </MotionCard>
            );
          })}
        </div>

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
            {/* Payment accounts */}
            <div className="space-y-3 max-h-[45vh] overflow-y-auto pe-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t("pricing.payment_methods_heading")}
              </p>

              {/* 1. NBP */}
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1.5">
                <p className="text-sm font-semibold text-foreground">
                  {t("pricing.payment_method_nbp")}
                </p>
                <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm items-center">
                  <span className="text-muted-foreground">{t("pricing.payment_account_title")}:</span>
                  <span className="font-medium" dir="ltr">Al-Ulama</span>
                  <span className="text-muted-foreground">{t("pricing.payment_iban")}:</span>
                  <CopyValue value="PK04NBPA1997004243449556" mono small label={t("pricing.payment_iban")} copyLabel={t("pricing.copy")} copiedLabel={t("pricing.copied")} />
                  <span className="text-muted-foreground">{t("pricing.payment_branch")}:</span>
                  <span className="font-medium" dir="ltr">Badami Bagh 1997</span>
                </div>
              </div>

              {/* 2. JazzCash Business */}
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1.5">
                <p className="text-sm font-semibold text-foreground">
                  {t("pricing.payment_method_jazzcash_business")}
                </p>
                <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm items-center">
                  <span className="text-muted-foreground">{t("pricing.payment_account_title")}:</span>
                  <span className="font-medium" dir="ltr">Ulama Centre</span>
                  <span className="text-muted-foreground">{t("pricing.payment_till_id")}:</span>
                  <CopyValue value="00420745" mono label={t("pricing.payment_till_id")} copyLabel={t("pricing.copy")} copiedLabel={t("pricing.copied")} />
                </div>
              </div>

              {/* 3. JazzCash Personal */}
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1.5">
                <p className="text-sm font-semibold text-foreground">
                  {t("pricing.payment_method_jazzcash_personal")}
                </p>
                <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm items-center">
                  <span className="text-muted-foreground">{t("pricing.payment_account_title")}:</span>
                  <span className="font-medium" dir="ltr">Hafiz Khizar Hayat</span>
                  <span className="text-muted-foreground">{t("pricing.payment_number")}:</span>
                  <PhoneValue display="0308 4164816" raw="03084164816" wa="923084164816" copyLabel={t("pricing.copy")} copiedLabel={t("pricing.copied")} waLabel={t("pricing.manual_note_whatsapp_label")} />
                </div>
              </div>

              {/* 4. EasyPaisa Personal */}
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1.5">
                <p className="text-sm font-semibold text-foreground">
                  {t("pricing.payment_method_easypaisa_personal")}
                </p>
                <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm items-center">
                  <span className="text-muted-foreground">{t("pricing.payment_account_title")}:</span>
                  <span className="font-medium" dir="ltr">Hafiz Khizar Hayat</span>
                  <span className="text-muted-foreground">{t("pricing.payment_number")}:</span>
                  <PhoneValue display="0308 4164816" raw="03084164816" copyLabel={t("pricing.copy")} copiedLabel={t("pricing.copied")} />
                </div>
              </div>
            </div>

            {/* Dynamic plan amount */}
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
              />
            </div>

            {/* Receipt upload */}
            <div className="space-y-1.5">
              <Label htmlFor="receipt">
                {language === "ur" ? "Receipt کی تصویر (JPG/PNG, ≤5MB)" : "Receipt image (JPG/PNG, ≤5MB)"}
              </Label>
              <Input
                id="receipt"
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              />
              {receiptFile && (
                <p className="text-xs text-muted-foreground">
                  {receiptFile.name} · {(receiptFile.size / 1024).toFixed(0)} KB
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {language === "ur"
                ? "AI آپ کی receipt کی تصدیق کرے گا۔ صحیح ہونے پر اکاؤنٹ فوری فعال ہو جائے گا، ورنہ admin خود review کرے گا۔"
                : "Our AI verifies your receipt. If valid, your account activates instantly — otherwise an admin will review it."}
            </p>

            <Button
              onClick={submitUpgradeRequest}
              disabled={submitting || !txId.trim() || !receiptFile}
              className="w-full"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin me-2" />
              ) : (
                <Crown className="h-4 w-4 me-2" />
              )}
              {language === "ur" ? "تصدیق کے لیے بھیجیں" : "Verify & activate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </AppLayout>
  );
};

export default Pricing;
