import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, XCircle, Users, Crown } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { UserRow, PaidTier, Tier } from "./types";

interface UserManagementProps {
  users: UserRow[];
  loading: boolean;
  onApprove: (userId: string, plan: PaidTier) => void | Promise<void>;
  onRevoke: (userId: string) => void | Promise<void>;
  onChangeTier: (userId: string, tier: Tier) => void | Promise<void>;
  tierLabel: (tier: string) => string;
}

const UserManagement = ({ users, loading, onApprove, onRevoke, onChangeTier, tierLabel }: UserManagementProps) => {
  const { t } = useLanguage();
  const [approvalPlanMap, setApprovalPlanMap] = useState<Record<string, string>>({});

  const handleApprove = async (userId: string) => {
    const plan = approvalPlanMap[userId] as PaidTier | undefined;
    if (!plan) return;
    await onApprove(userId, plan);
    setApprovalPlanMap((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5" />
          {t("admin.user_management")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">{t("admin.no_users")}</p>
        ) : (
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div
                key={u.user_id}
                className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">
                    {u.display_name || t("admin.unnamed")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <Badge variant={u.is_approved ? "default" : "destructive"}>
                    {u.is_approved ? t("admin.status_approved") : t("admin.status_pending")}
                  </Badge>

                  {u.is_approved ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRevoke(u.user_id)}
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    >
                      <XCircle className="h-4 w-4 me-1" />
                      {t("admin.revoke")}
                    </Button>
                  ) : (
                    <div className="flex w-full sm:w-auto items-center gap-2">
                      <Select
                        value={approvalPlanMap[u.user_id] ?? ""}
                        onValueChange={(val) =>
                          setApprovalPlanMap((prev) => ({ ...prev, [u.user_id]: val }))
                        }
                      >
                        <SelectTrigger className="h-9 flex-1 sm:w-[160px] sm:flex-none text-xs">
                          <SelectValue placeholder={t("admin.select_plan")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="basic">{t("admin.basic_plan")}</SelectItem>
                          <SelectItem value="pro">{t("admin.pro_plan_label")}</SelectItem>
                          <SelectItem value="ultra">
                            {t("admin.ultra_plan_label")}
                            <span className="ms-1 text-xs text-amber-600 font-normal">
                              ⚠ {t("admin.ultra_dev_warning")}
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        disabled={!approvalPlanMap[u.user_id]}
                        onClick={() => handleApprove(u.user_id)}
                        title={!approvalPlanMap[u.user_id] ? t("admin.plan_required") : undefined}
                      >
                        <CheckCircle className="h-4 w-4 me-1" />
                        {t("admin.approve")}
                      </Button>
                    </div>
                  )}

                  <Badge variant={u.tier === "free" ? "secondary" : "default"}>
                    {tierLabel(u.tier)}
                  </Badge>
                  {u.upgrade_requested && (
                    <Badge variant="outline" className="text-amber-600 border-amber-400">
                      {t("admin.upgrade_request")}
                    </Badge>
                  )}

                  {u.is_approved && (
                    <Select
                      value=""
                      onValueChange={(val) => onChangeTier(u.user_id, val as Tier)}
                    >
                      <SelectTrigger className="h-9 w-full sm:w-[130px] text-xs">
                        <Crown className="h-3.5 w-3.5 me-1 text-muted-foreground" />
                        <SelectValue placeholder={t("admin.change_tier")} />
                      </SelectTrigger>
                      <SelectContent>
                        {u.tier !== "ultra" && (
                          <SelectItem value="ultra">
                            <span className="text-purple-600">{t("admin.make_ultra")}</span>
                          </SelectItem>
                        )}
                        {u.tier !== "pro" && (
                          <SelectItem value="pro">
                            <span className="text-primary">{t("admin.make_pro")}</span>
                          </SelectItem>
                        )}
                        {u.tier !== "basic" && (
                          <SelectItem value="basic">{t("admin.make_basic")}</SelectItem>
                        )}
                        {u.tier !== "free" && (
                          <SelectItem value="free">
                            <span className="text-destructive">{t("admin.make_free")}</span>
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UserManagement;
