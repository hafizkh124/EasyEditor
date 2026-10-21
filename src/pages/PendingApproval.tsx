import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, ShieldAlert, RefreshCw, LogOut, MessageCircle, Loader2, Check, Crown, Zap, Star, Construction, Upload, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { PAYMENT_ACCOUNTS, WHATSAPP_CONTACT_URL, WHATSAPP_CONTACT_NUMBER } from "@/lib/paymentAccounts";
import { PLAN_TIERS, buildFeatures, type PaidTier } from "@/lib/planTiers";
import { cn } from "@/lib/utils";


const PENDING_CHECKOUT_KEY = "pendingCheckoutPlan";
const PENDING_CHECKOUT_METHOD_KEY = "pendingCheckoutMethod";

const PLAN_ICONS: Record<PaidTier, typeof Zap> = { basic: Zap, pro: Crown, ultra: Star };
const PLAN_COLORS: Record<PaidTier, { icon: string; border: string; bg: string; selectedBorder: string }> = {
  basic: {
    icon: "text-info",
    border: "border-info-border",
    bg: "bg-info/5",
    selectedBorder: "border-info ring-2 ring-info/30",
  },
  pro: {
    icon: "text-primary",
    border: "border-primary/30",
    bg: "bg-primary/5",
    selectedBorder: "border-primary ring-2 ring-primary/30",
  },
  ultra: {
    icon: "text-purple-500",
    border: "border-purple-300/50 dark:border-purple-700/40",
    bg: "bg-purple-500/5",
    selectedBorder: "border-purple-500 ring-2 ring-purple-500/30",
  },
};

const PendingApproval = () => {
  const { user, loading: authLoading } = useAuth();
  const { isApproved, displayName, loading: approvalLoading } = useApproval();
  const { t, direction } = useLanguage();
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<PaidTier>("basic");
  const [txId, setTxId] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [verifying, setVerifying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleVerifyReceipt = async () => {
    if (!user || !txId.trim() || !receiptFile) {
      toast.error(t("toast.payment.fields_required"));
      return;
    }
    if (receiptFile.size > 5 * 1024 * 1024) {
      toast.error(t("toast.upload.image_too_large"));
      return;
    }
    setVerifying(true);
    try {
      const ext = (receiptFile.name.split(".").pop() || "jpg").toLowerCase();
      const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("payment-receipts")
        .upload(storagePath, receiptFile, { contentType: receiptFile.type, upsert: false });
      if (upErr) throw new Error(upErr.message);

      const { data, error } = await supabase.functions.invoke("verify-receipt", {
        body: { planId: selectedPackage, referenceNo: txId.trim(), storagePath },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));

      if (data?.autoApproved) {
        toast.success(t("toast.account.activated"));
        setTimeout(() => navigate("/dashboard", { replace: true }), 600);
      } else {
        setTxId("");
        setReceiptFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        toast.success(t("toast.account.receipt_sent"));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  // Honor a pending checkout intent stored on the landing page before signup.
  // Auto-selects the chosen plan (manual flow only — no card checkout).
  useEffect(() => {
    if (!user) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    } catch {
      pending = null;
    }
    if (!pending) return;
    const plan = PLAN_TIERS.find((p) => p.id === pending && !p.comingSoon);
    try {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
      sessionStorage.removeItem(PENDING_CHECKOUT_METHOD_KEY);
    } catch {
      // ignore
    }
    if (!plan) return;
    setSelectedPackage(plan.id);
  }, [user]);

  const isComingSoon = (id: PaidTier) =>
    PLAN_TIERS.find((p) => p.id === id)?.comingSoon === true;
  void isComingSoon;

  // Poll approval status every 30s so the page auto-unlocks shortly after admin approves.
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("is_approved")
        .eq("user_id", user.id)
        .single();
      if (data?.is_approved === true) {
        toast.success(t("pending.approved_toast", "Your account has been approved!"));
        navigate("/dashboard", { replace: true });
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [user, navigate, t]);

  if (authLoading || approvalLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (isApproved === true) return <Navigate to="/dashboard" replace />;

  const handleRefresh = async () => {
    setRefreshing(true);
    const { data } = await supabase
      .from("profiles")
      .select("is_approved")
      .eq("user_id", user.id)
      .single();
    setRefreshing(false);
    if (data?.is_approved === true) {
      toast.success(t("pending.approved_toast", "Your account has been approved!"));
      navigate("/dashboard", { replace: true });
    } else {
      toast.info(t("pending.still_pending", "Still pending — please contact admin if you have already paid."));
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("pending.copied", "Copied!"));
    } catch {
      toast.error(t("pending.copy_failed", "Could not copy"));
    }
  };

  // Build personalized WhatsApp message
  const userName = displayName || user.email?.split("@")[0] || "";
  const userEmail = user.email || "";
  const selectedPlan = PLAN_TIERS.find((p) => p.id === selectedPackage)!;
  const packageLabel = t(selectedPlan.nameKey as import("@/lib/i18n").TranslationKey) || selectedPackage;

  const whatsappMessage = encodeURIComponent(
    `Assalam-o-Alaikum,\n` +
    `${t("pending.wa_name", "Name")}: ${userName}\n` +
    `${t("pending.wa_email", "Email")}: ${userEmail}\n` +
    `${t("pending.wa_package", "Package")}: ${packageLabel} (${selectedPlan.price})\n\n` +
    (t("pending.whatsapp_template", "I have transferred the subscription fee. Please find the receipt attached.")),
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir={direction}>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header Card */}
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <CardTitle className="text-xl">{t("pending.title", "Awaiting Admin Approval")}</CardTitle>
              <Badge variant="destructive" className="ms-auto">{t("pending.status_pending", "Pending")}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("pending.intro", "Thank you for registering! To activate your account, please complete the payment steps below and send us your receipt via WhatsApp.")}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1.5 ps-5 text-sm">
              <li>{t("pending.step1", "Select your preferred package below.")}</li>
              <li>{t("pending.step2", "Transfer the subscription fee to one of the accounts below.")}</li>
              <li>{t("pending.step3", "Take a screenshot of the transfer receipt.")}</li>
              <li>{t("pending.step4", "Send the screenshot on WhatsApp to the number below.")}</li>
              <li>{t("pending.step5", "Wait for admin approval — usually within a few hours.")}</li>
            </ol>
          </CardContent>
        </Card>

        {/* Package Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("pending.select_package", "Select Your Package")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("pending.select_package_desc", "Choose the plan that suits your needs.")}
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {PLAN_TIERS.map((plan) => {
              const Icon = PLAN_ICONS[plan.id];
              const colors = PLAN_COLORS[plan.id];
              const isSelected = selectedPackage === plan.id;
              const isDisabled = plan.comingSoon;
              const features = buildFeatures(plan.featureTemplates, t);
              // Only show included features for compact view
              const includedFeatures = features.filter((f) => f.included);

              return (
                <button
                  key={plan.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setSelectedPackage(plan.id)}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-start transition-all",
                    colors.bg,
                    isDisabled
                      ? "cursor-not-allowed opacity-60 border-border"
                      : isSelected
                        ? colors.selectedBorder
                        : `${colors.border} hover:shadow-md cursor-pointer`,
                  )}
                >
                  {/* Badges */}
                  {plan.popular && (
                    <Badge className="absolute -top-2.5 end-3 bg-primary text-primary-foreground text-xs px-2">
                      {t("pending.recommended", "Recommended")}
                    </Badge>
                  )}
                  {plan.comingSoon && (
                    <Badge variant="secondary" className="absolute -top-2.5 end-3 text-xs px-2">
                      <Construction className="h-3 w-3 me-1" />
                      {t("pending.coming_soon", "Coming Soon")}
                    </Badge>
                  )}

                  {/* Selected checkmark */}
                  {isSelected && !isDisabled && (
                    <div className="absolute top-2 end-2 rounded-full bg-primary p-0.5">
                      <Check className="h-3 w-3 text-primary-foreground" />
                    </div>
                  )}

                  {/* Plan header */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className={cn("rounded-lg p-1.5", colors.bg)}>
                      <Icon className={cn("h-4 w-4", colors.icon)} />
                    </div>
                    <span className="font-semibold text-sm">{t(plan.nameKey as import("@/lib/i18n").TranslationKey)}</span>
                  </div>

                  {/* Price */}
                  <div className="text-lg font-bold mb-3">{plan.price}</div>

                  {/* Features */}
                  <ul className="space-y-1">
                    {includedFeatures.map((f, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Check className="h-3 w-3 text-success flex-shrink-0" />
                        <span>{f.label}</span>
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Card payment section removed — manual receipt verification only */}


        {/* Payment Accounts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("pending.payment_accounts", "Payment Accounts")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("pending.transfer_amount", "Transfer the amount for your selected package:")}{" "}
              <span className="font-semibold text-foreground">{selectedPlan.price}</span>
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {PAYMENT_ACCOUNTS.map((acc, i) => (
              <div key={i} className="rounded-lg border border-border p-4 space-y-2 bg-card">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(acc.methodKey as import("@/lib/i18n").TranslationKey) || acc.methodKey}
                </div>
                <div className="font-medium">{acc.title}</div>
                <div className="space-y-1">
                  {acc.rows.map((r, j) => (
                    <div key={j} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">{t(r.labelKey as import("@/lib/i18n").TranslationKey) || r.labelKey}</div>
                        <div className={r.mono ? "font-mono text-sm break-all" : "text-sm"}>{r.value}</div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 min-h-touch min-w-touch md:min-h-0 md:min-w-0 flex-shrink-0"
                        onClick={() => copyValue(r.value)}
                        aria-label={t("pending.copy", "Copy")}
                        data-approval-allow
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Receipt Verification */}
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-primary" />
              {direction === "rtl" ? "سسٹم سے فوری تصدیق" : "Instant System Verification"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {direction === "rtl"
                ? "Receipt اپلوڈ کریں۔ سسٹم تصدیق کے بعد آپ کا اکاؤنٹ فوری فعال ہو جائے گا۔ کوئی مسئلہ ہونے پر ہماری ٹیم manually review کرے گی۔"
                : "Upload your receipt — once our system verifies it, your account activates instantly. If there is any issue, our team will review it manually."}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pa-txid">{direction === "rtl" ? "ٹرانزیکشن آئی ڈی" : "Transaction ID"}</Label>
              <Input
                id="pa-txid"
                value={txId}
                onChange={(e) => setTxId(e.target.value)}
                placeholder={direction === "rtl" ? "مثلاً JazzCash TXN #12345" : "e.g. JazzCash TXN #12345"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pa-receipt">
                {direction === "rtl" ? "Receipt کی تصویر (JPG/PNG, ≤5MB)" : "Receipt image (JPG/PNG, ≤5MB)"}
              </Label>
              <Input
                id="pa-receipt"
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
            <Button
              onClick={handleVerifyReceipt}
              disabled={verifying || !txId.trim() || !receiptFile}
              className="w-full"
              data-approval-allow
            >
              {verifying ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Upload className="h-4 w-4 me-2" />}
              {direction === "rtl" ? "تصدیق کے لیے بھیجیں" : "Verify & activate"}
            </Button>
          </CardContent>
        </Card>

        {/* WhatsApp Card */}
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="space-y-0.5">
              <p className="font-medium text-sm">{t("pending.whatsapp_label", "Send Receipt on WhatsApp")}</p>
              <p className="text-xs text-muted-foreground font-mono">+{WHATSAPP_CONTACT_NUMBER}</p>
            </div>
            <Button
              asChild
              className="bg-success hover:bg-success/90 text-success-foreground"
              data-approval-allow
            >
              <a
                href={`${WHATSAPP_CONTACT_URL}?text=${whatsappMessage}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="h-4 w-4 me-2" />
                {t("pending.send_receipt", "Open WhatsApp")}
              </a>
            </Button>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex-1"
            data-approval-allow
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin me-2" />
            ) : (
              <RefreshCw className="h-4 w-4 me-2" />
            )}
            {t("pending.refresh_status", "Refresh Status")}
          </Button>
          <Button
            variant="ghost"
            onClick={handleSignOut}
            className="flex-1 text-muted-foreground"
            data-approval-allow
          >
            <LogOut className="h-4 w-4 me-2" />
            {t("pending.sign_out", "Sign Out")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PendingApproval;
