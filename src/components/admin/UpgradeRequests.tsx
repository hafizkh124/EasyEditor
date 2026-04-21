import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, CreditCard } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { UserRow } from "./types";

interface UpgradeRequestsProps {
  requests: UserRow[];
  loading: boolean;
  onApprove: (userId: string, pendingTier: string) => void | Promise<void>;
  onReject: (userId: string) => void | Promise<void>;
  tierLabel: (tier: string) => string;
}

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
          <div className="divide-y divide-border">
            {requests.map((u) => (
              <div key={u.user_id} className="py-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium text-foreground">
                      {u.display_name || t("admin.unnamed")}
                    </p>
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
                    {u.last_upgrade_request && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(u.last_upgrade_request).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
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
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UpgradeRequests;
