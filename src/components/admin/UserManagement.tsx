import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle, XCircle, Users, Crown, Ban, Undo2, RefreshCw, CalendarClock } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { UserRow, PaidTier, Tier } from "./types";
import { getLifecycleInfo, formatLifecycleDate } from "@/lib/subscriptionLifecycle";

interface UserManagementProps {
  users: UserRow[];
  loading: boolean;
  onApprove: (userId: string, plan: PaidTier) => void | Promise<void>;
  onRevoke: (userId: string) => void | Promise<void>;
  onReject: (userId: string, reason: string) => void | Promise<void>;
  onUnreject: (userId: string) => void | Promise<void>;
  onRenew: (userId: string) => void | Promise<void>;
  onChangeTier: (userId: string, tier: Tier) => void | Promise<void>;
  tierLabel: (tier: string) => string;
}

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const UserManagement = ({
  users,
  loading,
  onApprove,
  onRevoke,
  onReject,
  onUnreject,
  onRenew,
  onChangeTier,
  tierLabel,
}: UserManagementProps) => {
  const { t } = useLanguage();
  const [approvalPlanMap, setApprovalPlanMap] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [rejectingUser, setRejectingUser] = useState<UserRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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

  const openRejectDialog = (user: UserRow) => {
    setRejectingUser(user);
    setRejectReason("");
  };

  const confirmReject = async () => {
    if (!rejectingUser) return;
    await onReject(rejectingUser.user_id, rejectReason);
    setRejectingUser(null);
    setRejectReason("");
  };

  const getUserStatus = (u: UserRow): "approved" | "rejected" | "pending" => {
    if (u.is_approved) return "approved";
    if (u.rejection_status === "rejected") return "rejected";
    return "pending";
  };

  const filteredUsers =
    statusFilter === "all" ? users : users.filter((u) => getUserStatus(u) === statusFilter);

  const counts = {
    pending: users.filter((u) => getUserStatus(u) === "pending").length,
    approved: users.filter((u) => getUserStatus(u) === "approved").length,
    rejected: users.filter((u) => getUserStatus(u) === "rejected").length,
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            {t("admin.user_management")}
          </CardTitle>
          <div className="flex flex-wrap gap-2 pt-2">
            {(["all", "pending", "approved", "rejected"] as StatusFilter[]).map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(s)}
                className="h-7 text-xs"
              >
                {s === "all"
                  ? `${t("admin.filter_all") || "All"} (${users.length})`
                  : s === "pending"
                  ? `${t("admin.status_pending") || "Pending"} (${counts.pending})`
                  : s === "approved"
                  ? `${t("admin.status_approved") || "Approved"} (${counts.approved})`
                  : `${t("admin.status_rejected") || "Rejected"} (${counts.rejected})`}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t("admin.no_users")}</p>
          ) : (
            <div className="divide-y divide-border">
              {filteredUsers.map((u) => {
                const status = getUserStatus(u);
                const lifecycle = getLifecycleInfo({
                  tier: u.tier,
                  activatedAt: u.activated_at,
                  expiresAt: u.expires_at,
                });
                return (
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
                      {status === "rejected" && u.rejection_reason && (
                        <p className="text-xs text-destructive/80 mt-1 italic">
                          {t("admin.rejection_reason_label") || "Reason"}: {u.rejection_reason}
                        </p>
                      )}
                      {lifecycle.status !== "none" && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {t("admin.activated_on") || "Activated"}: {formatLifecycleDate(lifecycle.activatedAt)}
                          </span>
                          <span>•</span>
                          <span>
                            {t("admin.expires_on") || "Expires"}: {formatLifecycleDate(lifecycle.expiresAt)}
                          </span>
                          {(u.renewal_count ?? 0) > 0 && (
                            <>
                              <span>•</span>
                              <span>{t("admin.renewals") || "Renewals"}: {u.renewal_count}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      {status === "approved" && (
                        <Badge variant="default">{t("admin.status_approved")}</Badge>
                      )}
                      {status === "pending" && (
                        <Badge variant="destructive">{t("admin.status_pending")}</Badge>
                      )}
                      {status === "rejected" && (
                        <Badge variant="outline" className="text-destructive border-destructive/40">
                          {t("admin.status_rejected") || "Rejected"}
                        </Badge>
                      )}

                      {status === "approved" && lifecycle.status === "expiring_soon" && (
                        <Badge variant="outline" className="text-amber-600 border-amber-400">
                          {(t("admin.expiring_in") || "Expires in {n}d").replace("{n}", String(lifecycle.daysRemaining ?? 0))}
                        </Badge>
                      )}
                      {status === "approved" && lifecycle.status === "expired" && (
                        <Badge variant="outline" className="text-destructive border-destructive/40">
                          {t("admin.expired") || "Expired"}
                        </Badge>
                      )}

                      {status === "approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRenew(u.user_id)}
                          className="text-green-700 border-green-300 hover:bg-green-50"
                        >
                          <RefreshCw className="h-4 w-4 me-1" />
                          {t("admin.renew") || "Renew"}
                        </Button>
                      )}

                      {status === "approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRevoke(u.user_id)}
                          className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        >
                          <XCircle className="h-4 w-4 me-1" />
                          {t("admin.revoke")}
                        </Button>
                      )}

                      {status === "pending" && (
                        <div className="flex w-full sm:w-auto items-center gap-2 flex-wrap">
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openRejectDialog(u)}
                            className="text-destructive border-destructive/30 hover:bg-destructive/10"
                          >
                            <Ban className="h-4 w-4 me-1" />
                            {t("admin.reject") || "Reject"}
                          </Button>
                        </div>
                      )}

                      {status === "rejected" && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Select
                            value={approvalPlanMap[u.user_id] ?? ""}
                            onValueChange={(val) =>
                              setApprovalPlanMap((prev) => ({ ...prev, [u.user_id]: val }))
                            }
                          >
                            <SelectTrigger className="h-9 w-[140px] text-xs">
                              <SelectValue placeholder={t("admin.select_plan")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="basic">{t("admin.basic_plan")}</SelectItem>
                              <SelectItem value="pro">{t("admin.pro_plan_label")}</SelectItem>
                              <SelectItem value="ultra">{t("admin.ultra_plan_label")}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            disabled={!approvalPlanMap[u.user_id]}
                            onClick={() => handleApprove(u.user_id)}
                          >
                            <CheckCircle className="h-4 w-4 me-1" />
                            {t("admin.approve")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onUnreject(u.user_id)}
                          >
                            <Undo2 className="h-4 w-4 me-1" />
                            {t("admin.unreject") || "Return to Pending"}
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

                      {status === "approved" && (
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
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejectingUser} onOpenChange={(open) => !open && setRejectingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.reject_dialog_title") || "Reject User"}</DialogTitle>
            <DialogDescription>
              {(t("admin.reject_dialog_desc") || "Optional: explain why this user is being rejected. The reason will be shown to them.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {rejectingUser?.display_name || t("admin.unnamed")}
            </p>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("admin.reject_reason_placeholder") || "Reason (optional)"}
              rows={3}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectingUser(null)}>
              {t("admin.cancel") || "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
            >
              <Ban className="h-4 w-4 me-1" />
              {t("admin.confirm_reject") || "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default UserManagement;
