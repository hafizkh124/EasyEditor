import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useLanguage } from "@/contexts/LanguageContext";
import { TIER_LIMITS } from "@/contexts/SubscriptionContext";
import { Navigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle, XCircle, Users, Shield, Crown, CreditCard } from "lucide-react";

interface UserRow {
  user_id: string;
  display_name: string | null;
  is_approved: boolean;
  created_at: string;
  tier: string;
  upgrade_requested: boolean;
  pending_tier: string | null;
  payment_reference: string | null;
  last_upgrade_request: string | null;
}

type PaidTier = "basic" | "pro" | "ultra";

const Admin = () => {
  const { user } = useAuth();
  const { isAdmin, loading: approvalLoading } = useApproval();
  const { t, direction } = useLanguage();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(true);

  // Per-user plan selection for the approve-with-plan dropdown
  const [approvalPlanMap, setApprovalPlanMap] = useState<Record<string, string>>({});

  // Server-side admin role verification
  useEffect(() => {
    if (!user || approvalLoading) return;

    const verifyAdminRole = async () => {
      if (import.meta.env.DEV) console.log("[Admin] Verifying access...");
      setVerifying(true);

      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (error) {
        if (import.meta.env.DEV) console.error("[Admin] Role verification failed:", error.message);
        setVerified(false);
      } else {
        const isVerifiedAdmin = data !== null;
        if (import.meta.env.DEV) console.log("[Admin] Verified:", isVerifiedAdmin);
        setVerified(isVerifiedAdmin);
      }

      setVerifying(false);
    };

    verifyAdminRole();
  }, [user, approvalLoading]);

  const fetchUsers = async () => {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, is_approved, created_at")
      .order("created_at", { ascending: false });

    const { data: subs } = await supabase
      .from("subscriptions")
      .select("user_id, tier, upgrade_requested, pending_tier, payment_reference, last_upgrade_request");

    if (profiles) {
      const subMap = new Map((subs || []).map((s) => [s.user_id, s]));
      setUsers(
        profiles.map((p) => ({
          ...p,
          tier: subMap.get(p.user_id)?.tier || "free",
          upgrade_requested: subMap.get(p.user_id)?.upgrade_requested || false,
          pending_tier: subMap.get(p.user_id)?.pending_tier || null,
          payment_reference: subMap.get(p.user_id)?.payment_reference || null,
          last_upgrade_request: subMap.get(p.user_id)?.last_upgrade_request || null,
        }))
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    if (verified) fetchUsers();
  }, [verified]);

  const sendNotification = async (userId: string, title: string, message: string) => {
    await supabase.from("notifications").insert({ user_id: userId, title, message });
  };

  /**
   * Atomically approve a new user: set is_approved=true + assign tier + limits.
   * This is the only path for first-time approval of unapproved (free/0-limit) accounts.
   */
  const approveWithPlan = async (userId: string, plan: PaidTier) => {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ is_approved: true })
      .eq("user_id", userId);

    if (profileError) {
      toast.error(t("admin.update_error"));
      return;
    }

    const limits = TIER_LIMITS[plan];
    const { error: subError } = await supabase
      .from("subscriptions")
      .update({ tier: plan, ...limits })
      .eq("user_id", userId);

    if (subError) {
      if (import.meta.env.DEV)
        console.error("[Admin] subscriptions PATCH failed →", subError.code, subError.message, subError.details);
      toast.error(`${t("admin.update_error")}: ${subError.message}`);
      return;
    }

    await sendNotification(
      userId,
      t("notification.account_approved_title"),
      t("notification.account_approved_msg").replace("{plan}", plan.toUpperCase())
    );

    toast.success(t("admin.approved"));
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === userId ? { ...u, is_approved: true, tier: plan } : u
      )
    );
    setApprovalPlanMap((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  };

  /**
   * Revoke approval: set is_approved=false + reset tier='free' with all limits=0.
   */
  const revokeApproval = async (userId: string) => {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ is_approved: false })
      .eq("user_id", userId);

    if (profileError) {
      toast.error(t("admin.update_error"));
      return;
    }

    const { error: subError } = await supabase
      .from("subscriptions")
      .update({ tier: "free", ...TIER_LIMITS.free })
      .eq("user_id", userId);

    if (subError) {
      if (import.meta.env.DEV)
        console.error("[Admin] revoke subscriptions PATCH failed →", subError.code, subError.message, subError.details);
      toast.error(`${t("admin.update_error")}: ${subError.message}`);
      return;
    }

    toast.success(t("admin.rejected"));
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === userId ? { ...u, is_approved: false, tier: "free" } : u
      )
    );
  };

  const changeTier = async (userId: string, newTier: "free" | "basic" | "pro" | "ultra") => {
    const limits = TIER_LIMITS[newTier];
    const updates: Record<string, unknown> = {
      tier: newTier,
      upgrade_requested: false,
      pending_tier: null,
      payment_reference: null,
      last_upgrade_request: null,
      ...limits,
    };

    const { error } = await supabase
      .from("subscriptions")
      .update(updates)
      .eq("user_id", userId);

    if (error) {
      if (import.meta.env.DEV)
        console.error("[Admin] changeTier PATCH failed →", error.code, error.message, error.details);
      toast.error(`${t("admin.update_error")}: ${error.message}`);
      return;
    }

    const successMsg =
      newTier === "ultra"
        ? t("admin.upgraded_ultra")
        : newTier === "pro"
        ? t("admin.upgraded_pro")
        : newTier === "basic"
        ? t("admin.upgraded_basic")
        : t("admin.downgraded_free");

    toast.success(successMsg);
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === userId
          ? { ...u, tier: newTier, upgrade_requested: false, pending_tier: null, payment_reference: null, last_upgrade_request: null }
          : u
      )
    );
  };

  const approveUpgrade = async (userId: string, pendingTier: string) => {
    const tier = pendingTier as "free" | "basic" | "pro" | "ultra";
    await changeTier(userId, tier);
    await sendNotification(
      userId,
      t("notification.upgrade_approved_title"),
      t("notification.upgrade_approved_msg").replace("{tier}", tier.toUpperCase())
    );
    toast.success(t("admin.upgrade_approved"));
  };

  const rejectUpgrade = async (userId: string) => {
    const { error } = await supabase
      .from("subscriptions")
      .update({
        upgrade_requested: false,
        pending_tier: null,
        payment_reference: null,
        last_upgrade_request: null,
      })
      .eq("user_id", userId);

    if (error) {
      toast.error(t("admin.update_error"));
    } else {
      await sendNotification(
        userId,
        t("notification.upgrade_rejected_title"),
        t("notification.upgrade_rejected_msg")
      );
      toast.success(t("admin.upgrade_rejected"));
      setUsers((prev) =>
        prev.map((u) =>
          u.user_id === userId
            ? { ...u, upgrade_requested: false, pending_tier: null, payment_reference: null, last_upgrade_request: null }
            : u
        )
      );
    }
  };

  const tierLabel = (tier: string) => {
    if (tier === "ultra") return t("settings.ultra");
    if (tier === "pro") return t("settings.pro");
    if (tier === "basic") return t("settings.basic");
    return t("settings.free");
  };

  if (approvalLoading || verifying) return null;
  if (!isAdmin || !verified) return <Navigate to="/" replace />;

  const upgradeRequests = users.filter((u) => u.upgrade_requested);

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6" dir={direction}>
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{t("admin.title")}</h1>
        </div>

        <Tabs defaultValue="users">
          <TabsList className="mb-4">
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              {t("admin.user_management")}
            </TabsTrigger>
            <TabsTrigger value="upgrades" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              {t("admin.upgrade_requests")}
              {upgradeRequests.length > 0 && (
                <Badge className="ms-1 h-5 min-w-5 rounded-full px-1.5 text-xs">
                  {upgradeRequests.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* User Management Tab */}
          <TabsContent value="users">
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
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Approval badge */}
                          <Badge variant={u.is_approved ? "default" : "destructive"}>
                            {u.is_approved ? t("admin.status_approved") : t("admin.status_pending")}
                          </Badge>

                          {u.is_approved ? (
                            /* Revoke button */
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => revokeApproval(u.user_id)}
                              className="text-destructive border-destructive/30 hover:bg-destructive/10"
                            >
                              <XCircle className="h-4 w-4 me-1" />
                              {t("admin.revoke")}
                            </Button>
                          ) : (
                            /* Plan selector + Approve button (unapproved users) */
                            <div className="flex items-center gap-2">
                              <Select
                                value={approvalPlanMap[u.user_id] ?? ""}
                                onValueChange={(val) =>
                                  setApprovalPlanMap((prev) => ({ ...prev, [u.user_id]: val }))
                                }
                              >
                                <SelectTrigger className="h-8 w-[160px] text-xs">
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
                                onClick={() =>
                                  approveWithPlan(u.user_id, approvalPlanMap[u.user_id] as PaidTier)
                                }
                                title={!approvalPlanMap[u.user_id] ? t("admin.plan_required") : undefined}
                              >
                                <CheckCircle className="h-4 w-4 me-1" />
                                {t("admin.approve")}
                              </Button>
                            </div>
                          )}

                          {/* Tier badge */}
                          <Badge variant={u.tier === "free" ? "secondary" : "default"}>
                            {tierLabel(u.tier)}
                          </Badge>
                          {u.upgrade_requested && (
                            <Badge variant="outline" className="text-amber-600 border-amber-400">
                              {t("admin.upgrade_request")}
                            </Badge>
                          )}

                          {/* Tier change controls (approved users only) */}
                          {u.is_approved && (
                            <>
                              {u.tier !== "ultra" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => changeTier(u.user_id, "ultra")}
                                  className="text-purple-600 border-purple-400/50 hover:bg-purple-50 dark:hover:bg-purple-950/20"
                                >
                                  <Crown className="h-4 w-4 me-1" />
                                  {t("admin.make_ultra")}
                                </Button>
                              )}
                              {u.tier !== "pro" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => changeTier(u.user_id, "pro")}
                                  className="text-primary border-primary/30 hover:bg-primary/10"
                                >
                                  <Crown className="h-4 w-4 me-1" />
                                  {t("admin.make_pro")}
                                </Button>
                              )}
                              {u.tier !== "basic" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => changeTier(u.user_id, "basic")}
                                >
                                  {t("admin.make_basic")}
                                </Button>
                              )}
                              {u.tier !== "free" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => changeTier(u.user_id, "free")}
                                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                                >
                                  {t("admin.make_free")}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Upgrade Requests Tab */}
          <TabsContent value="upgrades">
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
                ) : upgradeRequests.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    {t("admin.no_upgrade_requests")}
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {upgradeRequests.map((u) => (
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
                              onClick={() => approveUpgrade(u.user_id, u.pending_tier || "pro")}
                            >
                              <CheckCircle className="h-4 w-4 me-1" />
                              {t("admin.approve_upgrade")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => rejectUpgrade(u.user_id)}
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
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default Admin;
