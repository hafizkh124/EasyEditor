import { Navigate, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle, LogOut, MessageCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { WHATSAPP_CONTACT_URL, WHATSAPP_CONTACT_NUMBER } from "@/lib/paymentAccounts";

const AccountRejected = () => {
  const { user, loading: authLoading } = useAuth();
  const { isApproved, rejectionStatus, rejectionReason, loading: approvalLoading } = useApproval();
  const { t, direction } = useLanguage();
  const navigate = useNavigate();

  if (authLoading || approvalLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (isApproved === true) return <Navigate to="/dashboard" replace />;
  if (rejectionStatus !== "rejected") return <Navigate to="/pending-approval" replace />;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const appealMessage = encodeURIComponent(
    t("rejected.whatsapp_template") ||
      "Assalam-o-Alaikum, my account has been rejected. I would like to appeal / provide more information.",
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir={direction}>
      <div className="max-w-2xl mx-auto">
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              <CardTitle className="text-xl">{t("rejected.title") || "Account Rejected"}</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("rejected.intro") ||
                "Your account registration has been rejected by the administrator. If you believe this is a mistake, please contact us on WhatsApp."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {rejectionReason && (
              <div className="rounded-md border border-destructive/30 bg-background p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  {t("rejected.reason_label") || "Reason"}
                </div>
                <p className="text-sm">{rejectionReason}</p>
              </div>
            )}

            <div className="rounded-md border border-green-500/30 bg-green-500/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
              <div>
                <p className="font-medium text-sm">{t("rejected.appeal_label") || "Appeal via WhatsApp"}</p>
                <p className="text-xs text-muted-foreground font-mono">+{WHATSAPP_CONTACT_NUMBER}</p>
              </div>
              <Button asChild className="bg-green-600 hover:bg-green-700 text-white">
                <a
                  href={`${WHATSAPP_CONTACT_URL}?text=${appealMessage}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="h-4 w-4 me-2" />
                  {t("rejected.contact_admin") || "Contact Admin"}
                </a>
              </Button>
            </div>

            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full text-muted-foreground"
            >
              <LogOut className="h-4 w-4 me-2" />
              {t("rejected.sign_out") || "Sign Out"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AccountRejected;
