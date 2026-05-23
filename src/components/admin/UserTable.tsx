import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle,
  XCircle,
  Crown,
  Ban,
  Undo2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  MapPin,
  Briefcase,
  Coins,
  CalendarClock,
  Gift,
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { UserRow, PaidTier, Tier } from "./types";
import { getLifecycleInfo, formatLifecycleDate } from "@/lib/subscriptionLifecycle";
import { buildWhatsAppLink } from "@/lib/phoneValidation";

interface UserTableProps {
  users: UserRow[];
  loading: boolean;
  onApprove: (userId: string, plan: PaidTier) => void | Promise<void>;
  onRevoke: (userId: string) => void | Promise<void>;
  onReject: (userId: string, reason: string) => void | Promise<void>;
  onUnreject: (userId: string) => void | Promise<void>;
  onRenew: (userId: string) => void | Promise<void>;
  onChangeTier: (userId: string, tier: Tier) => void | Promise<void>;
  onRecordPayment: (user: UserRow) => void;
  tierLabel: (tier: string) => string;
}

const UserTable = ({
  users,
  loading,
  onApprove,
  onRevoke,
  onReject,
  onUnreject,
  onRenew,
  onChangeTier,
  onRecordPayment,
  tierLabel,
}: UserTableProps) => {
  const { t } = useLanguage();
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [approvalPlanMap, setApprovalPlanMap] = useState<Record<string, string>>({});
  const [rejectingUser, setRejectingUser] = useState<UserRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const getUserStatus = (u: UserRow): "approved" | "rejected" | "pending" => {
    if (u.is_approved) return "approved";
    if (u.rejection_status === "rejected") return "rejected";
    return "pending";
  };

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

  const confirmReject = async () => {
    if (!rejectingUser) return;
    await onReject(rejectingUser.user_id, rejectReason);
    setRejectingUser(null);
    setRejectReason("");
  };

  const toggleRow = (userId: string) =>
    setExpandedRow((prev) => (prev === userId ? null : userId));

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (users.length === 0) {
    return <p className="text-muted-foreground text-center py-8">{t("admin.no_results")}</p>;
  }

  return (
    <>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]" />
              <TableHead className="text-start">{t("admin.name_label")}</TableHead>
              <TableHead className="text-start hidden md:table-cell">{t("admin.email_label")}</TableHead>
              <TableHead className="text-start">{t("admin.status_label")}</TableHead>
              <TableHead className="text-start">{t("admin.tier_label")}</TableHead>
              <TableHead className="text-start hidden lg:table-cell">{t("admin.tokens_label")}</TableHead>
              <TableHead className="text-start hidden lg:table-cell">{t("admin.date_label")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const status = getUserStatus(u);
              const isExpanded = expandedRow === u.user_id;
              const totalTokens = (u.token_monthly_balance ?? 0) + (u.token_topup_balance ?? 0);
              const lifecycle = getLifecycleInfo({
                tier: u.tier,
                activatedAt: u.activated_at,
                expiresAt: u.expires_at,
              });

              return (
                <TableRow
                  key={u.user_id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleRow(u.user_id)}
                >
                  <TableCell colSpan={7} className="p-0">
                    {/* Main row */}
                    <div className="flex items-center gap-2 px-4 py-3">
                      <div className="flex-shrink-0">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {u.display_name || t("admin.unnamed")}
                        </p>
                      </div>
                      <div className="hidden md:block flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground truncate">{u.email || "—"}</p>
                      </div>
                      <div className="flex-shrink-0">
                        {status === "approved" && (
                          <Badge variant="default" className="text-[10px]">{t("admin.status_approved")}</Badge>
                        )}
                        {status === "pending" && (
                          <Badge variant="destructive" className="text-[10px]">{t("admin.status_pending")}</Badge>
                        )}
                        {status === "rejected" && (
                          <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">
                            {t("admin.status_rejected") || "Rejected"}
                          </Badge>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        <Badge variant={u.tier === "free" ? "secondary" : "default"} className="text-[10px]">
                          {tierLabel(u.tier)}
                        </Badge>
                      </div>
                      <div className="hidden lg:block flex-shrink-0 text-xs text-muted-foreground w-[70px] text-end">
                        {totalTokens.toLocaleString()}
                      </div>
                      <div className="hidden lg:block flex-shrink-0 text-xs text-muted-foreground w-[85px] text-end">
                        {new Date(u.created_at).toLocaleDateString()}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div
                        className="px-4 pb-4 pt-1 border-t bg-muted/30 space-y-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Info row */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {u.email && (
                            <span className="md:hidden">{u.email}</span>
                          )}
                          {u.whatsapp_number && (
                            <a
                              href={buildWhatsAppLink(u.whatsapp_number)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-green-700 hover:underline font-mono"
                            >
                              <MessageCircle className="h-3 w-3" />
                              {u.whatsapp_number}
                            </a>
                          )}
                          {u.country && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {u.country}
                            </span>
                          )}
                          {u.profession && (
                            <span className="flex items-center gap-1 capitalize">
                              <Briefcase className="h-3 w-3" />
                              {t(`onboarding.profession_${u.profession}`) || u.profession}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Coins className="h-3 w-3" />
                            Monthly: {u.token_monthly_balance ?? 0}/{u.token_monthly_limit ?? 0} • Top-up: {u.token_topup_balance ?? 0}
                          </span>
                          {(u.referred_by || (u.referral_credits ?? 0) > 0) && (
                            <span className="flex items-center gap-1">
                              <Gift className="h-3 w-3 text-green-600" />
                              {u.referred_by ? (t("admin.referred_user") || "Referred") : ""}
                              {(u.referral_credits ?? 0) > 0 ? ` • Credits: ${u.referral_credits}` : ""}
                            </span>
                          )}
                        </div>

                        {lifecycle.status !== "none" && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
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
                            {lifecycle.status === "expiring_soon" && (
                              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-400">
                                {(t("admin.expiring_in") || "Expires in {n}d").replace("{n}", String(lifecycle.daysRemaining ?? 0))}
                              </Badge>
                            )}
                            {lifecycle.status === "expired" && (
                              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">
                                {t("admin.expired") || "Expired"}
                              </Badge>
                            )}
                          </div>
                        )}

                        {status === "rejected" && u.rejection_reason && (
                          <p className="text-xs text-destructive/80 italic">
                            {t("admin.rejection_reason_label") || "Reason"}: {u.rejection_reason}
                          </p>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {status === "approved" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onRenew(u.user_id)}
                                className="text-green-700 border-green-300 hover:bg-green-50 h-7 text-xs"
                              >
                                <RefreshCw className="h-3.5 w-3.5 me-1" />
                                {t("admin.renew") || "Renew"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onRecordPayment(u)}
                                className="h-7 text-xs"
                              >
                                <Coins className="h-3.5 w-3.5 me-1" />
                                {t("admin.record_payment")}
                              </Button>
                              <Select
                                value=""
                                onValueChange={(val) => onChangeTier(u.user_id, val as Tier)}
                              >
                                <SelectTrigger className="h-7 w-[120px] text-xs">
                                  <Crown className="h-3 w-3 me-1 text-muted-foreground" />
                                  <SelectValue placeholder={t("admin.change_tier")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {u.tier !== "ultra" && <SelectItem value="ultra"><span className="text-purple-600">{t("admin.make_ultra")}</span></SelectItem>}
                                  {u.tier !== "pro" && <SelectItem value="pro"><span className="text-primary">{t("admin.make_pro")}</span></SelectItem>}
                                  {u.tier !== "basic" && <SelectItem value="basic">{t("admin.make_basic")}</SelectItem>}
                                  {u.tier !== "free" && <SelectItem value="free"><span className="text-destructive">{t("admin.make_free")}</span></SelectItem>}
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onRevoke(u.user_id)}
                                className="text-destructive border-destructive/30 hover:bg-destructive/10 h-7 text-xs"
                              >
                                <XCircle className="h-3.5 w-3.5 me-1" />
                                {t("admin.revoke")}
                              </Button>
                            </>
                          )}

                          {status === "pending" && (
                            <>
                              <Select
                                value={approvalPlanMap[u.user_id] ?? ""}
                                onValueChange={(val) =>
                                  setApprovalPlanMap((prev) => ({ ...prev, [u.user_id]: val }))
                                }
                              >
                                <SelectTrigger className="h-7 w-[150px] text-xs">
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
                                className="h-7 text-xs"
                              >
                                <CheckCircle className="h-3.5 w-3.5 me-1" />
                                {t("admin.approve")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setRejectingUser(u); setRejectReason(""); }}
                                className="text-destructive border-destructive/30 hover:bg-destructive/10 h-7 text-xs"
                              >
                                <Ban className="h-3.5 w-3.5 me-1" />
                                {t("admin.reject") || "Reject"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onRecordPayment(u)}
                                className="h-7 text-xs"
                              >
                                <Coins className="h-3.5 w-3.5 me-1" />
                                {t("admin.record_payment")}
                              </Button>
                            </>
                          )}

                          {status === "rejected" && (
                            <>
                              <Select
                                value={approvalPlanMap[u.user_id] ?? ""}
                                onValueChange={(val) =>
                                  setApprovalPlanMap((prev) => ({ ...prev, [u.user_id]: val }))
                                }
                              >
                                <SelectTrigger className="h-7 w-[150px] text-xs">
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
                                className="h-7 text-xs"
                              >
                                <CheckCircle className="h-3.5 w-3.5 me-1" />
                                {t("admin.approve")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onUnreject(u.user_id)}
                                className="h-7 text-xs"
                              >
                                <Undo2 className="h-3.5 w-3.5 me-1" />
                                {t("admin.unreject") || "Return to Pending"}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Reject dialog */}
      <Dialog open={!!rejectingUser} onOpenChange={(open) => !open && setRejectingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.reject_dialog_title") || "Reject User"}</DialogTitle>
            <DialogDescription>
              {t("admin.reject_dialog_desc") || "Optional: explain why this user is being rejected. The reason will be shown to them."}
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
            <Button variant="destructive" onClick={confirmReject}>
              <Ban className="h-4 w-4 me-1" />
              {t("admin.confirm_reject") || "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default UserTable;
