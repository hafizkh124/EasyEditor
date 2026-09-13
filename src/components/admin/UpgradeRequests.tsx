import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle, XCircle, CreditCard, Image as ImageIcon, Sparkles, AlertTriangle, Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { UserRow } from "./types";
import type { Translator } from "@/lib/i18n";

interface UpgradeRequestsProps {
  requests: UserRow[];
  loading: boolean;
  onApprove: (userId: string, pendingTier: string) => void | Promise<void>;
  onReject: (userId: string) => void | Promise<void>;
  tierLabel: (tier: string) => string;
}

const AiStatusBadge = ({ status, score, t }: { status: string | null; score: number | null; t: Translator }) => {
  if (!status || status === "none") return null;
  if (status === "auto_approved") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1">
        <Sparkles className="h-3 w-3" />
        {t("admin.ai_auto_approved")} {score !== null && `(${score}%)`}
      </Badge>
    );
  }
  if (status === "manual_review") {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 gap-1">
        <AlertTriangle className="h-3 w-3" />
        {t("admin.ai_manual_review")} {score !== null && `(AI: ${score}%)`}
      </Badge>
    );
  }
  if (status === "rejected") {
    return <Badge variant="destructive">{t("admin.ai_rejected")}</Badge>;
  }
  return null;
};

const ReceiptButton = ({ path, t }: { path: string | null; t: Translator }) => {
  const [loading, setLoading] = useState(false);
  if (!path) return null;
  const handleClick = async () => {
    setLoading(true);
    const { data, error } = await supabase.storage
      .from("payment-receipts")
      .createSignedUrl(path, 300);
    setLoading(false);
    if (error || !data?.signedUrl) {
      toast.error(t("admin.could_not_open_receipt"));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <ImageIcon className="h-4 w-4 me-1" />}
      {t("admin.view_receipt")}
    </Button>
  );
};

const UpgradeRequests = ({ requests, loading, onApprove, onReject, tierLabel }: UpgradeRequestsProps) => {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CreditCard className="h-5 w-5" />
          {t("admin.upgrade_requests")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : requests.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            {t("admin.no_upgrade_requests")}
          </p>
        ) : (
          <TooltipProvider>
            <div className="divide-y divide-border">
              {requests.map((u) => {
                const reasons =
                  (u.ai_verification_details as { reasons?: string[] } | null)?.reasons ?? [];
                return (
                  <div key={u.user_id} className="py-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-foreground">
                            {u.display_name || t("admin.unnamed")}
                          </p>
                          <AiStatusBadge status={u.ai_verification_status} score={u.ai_confidence_score} t={t} />
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>
                            {t("admin.user_management")}:{" "}
                            <span className="font-medium text-foreground">{tierLabel(u.tier)}</span>
                          </span>
                          <span>→</span>
                          <span>
                            {t("admin.pending_tier")}:{" "}
                            <span className="font-semibold text-primary">
                              {u.pending_tier ? tierLabel(u.pending_tier) : "—"}
                            </span>
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium">{t("admin.payment_ref")}:</span>{" "}
                          <code className="bg-muted rounded px-1 py-0.5 text-foreground">
                            {u.payment_reference || "—"}
                          </code>
                        </div>
                        {reasons.length > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-xs text-amber-700 dark:text-amber-400 underline-offset-2 hover:underline"
                              >
                                {t("admin.ai_flags_hover").replace("{n}", String(reasons.length))}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <ul className="list-disc ps-4 space-y-0.5 text-xs">
                                {reasons.map((r, i) => (
                                  <li key={i}>{r}</li>
                                ))}
                              </ul>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {u.last_upgrade_request && (
                          <p className="text-xs text-muted-foreground">
                            {new Date(u.last_upgrade_request).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 flex-shrink-0">
                        <ReceiptButton path={u.payment_proof_url} t={t} />
                        <Button
                          size="sm"
                          onClick={() => onApprove(u.user_id, u.pending_tier || "pro")}
                        >
                          <CheckCircle className="h-4 w-4 me-1" />
                          {t("admin.approve_upgrade")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onReject(u.user_id)}
                          className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        >
                          <XCircle className="h-4 w-4 me-1" />
                          {t("admin.reject_upgrade")}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
};

export default UpgradeRequests;
