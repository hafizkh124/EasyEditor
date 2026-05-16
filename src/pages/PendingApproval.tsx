import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, ShieldAlert, RefreshCw, LogOut, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { PAYMENT_ACCOUNTS, WHATSAPP_CONTACT_URL, WHATSAPP_CONTACT_NUMBER } from "@/lib/paymentAccounts";

const PendingApproval = () => {
  const { user, loading: authLoading } = useAuth();
  const { isApproved, loading: approvalLoading } = useApproval();
  const { t, direction } = useLanguage();
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);

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
        toast.success(t("pending.approved_toast") || "Your account has been approved!");
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
      toast.success(t("pending.approved_toast") || "Your account has been approved!");
      navigate("/dashboard", { replace: true });
    } else {
      toast.info(t("pending.still_pending") || "Still pending — please contact admin if you have already paid.");
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("pending.copied") || "Copied!");
    } catch {
      toast.error(t("pending.copy_failed") || "Could not copy");
    }
  };

  const whatsappMessage = encodeURIComponent(
    t("pending.whatsapp_template") ||
      "Assalam-o-Alaikum, I have transferred the subscription fee. Please find the receipt attached.",
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir={direction}>
      <div className="max-w-3xl mx-auto space-y-6">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <CardTitle className="text-xl">{t("pending.title") || "Awaiting Admin Approval"}</CardTitle>
              <Badge variant="destructive" className="ms-auto">{t("pending.status_pending") || "Pending"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("pending.intro") ||
                "Thank you for registering! To activate your account, please complete the payment steps below and send us your receipt via WhatsApp."}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1.5 ps-5 text-sm">
              <li>{t("pending.step1") || "Transfer the subscription fee to one of the accounts below."}</li>
              <li>{t("pending.step2") || "Take a screenshot of the transfer receipt."}</li>
              <li>{t("pending.step3") || "Send the screenshot on WhatsApp to the number below."}</li>
              <li>{t("pending.step4") || "Wait for admin approval — usually within a few hours."}</li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("pending.payment_accounts") || "Payment Accounts"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {PAYMENT_ACCOUNTS.map((acc, i) => (
              <div key={i} className="rounded-lg border border-border p-4 space-y-2 bg-card">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(acc.methodKey) || acc.methodKey}
                </div>
                <div className="font-medium">{acc.title}</div>
                <div className="space-y-1">
                  {acc.rows.map((r, j) => (
                    <div key={j} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] text-muted-foreground">{t(r.labelKey) || r.labelKey}</div>
                        <div className={r.mono ? "font-mono text-sm break-all" : "text-sm"}>{r.value}</div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 flex-shrink-0"
                        onClick={() => copyValue(r.value)}
                        aria-label={t("pending.copy") || "Copy"}
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

        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="space-y-0.5">
              <p className="font-medium text-sm">{t("pending.whatsapp_label") || "Send Receipt on WhatsApp"}</p>
              <p className="text-xs text-muted-foreground font-mono">+{WHATSAPP_CONTACT_NUMBER}</p>
            </div>
            <Button
              asChild
              className="bg-green-600 hover:bg-green-700 text-white"
              data-approval-allow
            >
              <a
                href={`${WHATSAPP_CONTACT_URL}?text=${whatsappMessage}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="h-4 w-4 me-2" />
                {t("pending.send_receipt") || "Open WhatsApp"}
              </a>
            </Button>
          </CardContent>
        </Card>

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
            {t("pending.refresh_status") || "Refresh Status"}
          </Button>
          <Button
            variant="ghost"
            onClick={handleSignOut}
            className="flex-1 text-muted-foreground"
            data-approval-allow
          >
            <LogOut className="h-4 w-4 me-2" />
            {t("pending.sign_out") || "Sign Out"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PendingApproval;
