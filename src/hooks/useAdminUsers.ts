import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { TIER_LIMITS } from "@/contexts/SubscriptionContext";
import type { UserRow, PaidTier, Tier } from "@/components/admin/types";

const sendNotification = (userId: string, title: string, message: string) =>
  supabase.from("notifications").insert({ user_id: userId, title, message });

export function useAdminUsers(enabled: boolean) {
  const { t } = useLanguage();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

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
    if (enabled) fetchUsers();
  }, [enabled]);

  const approveWithPlan = async (userId: string, plan: PaidTier) => {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ is_approved: true })
      .eq("user_id", userId);

    if (profileError) {
      toast.error(t("admin.update_error"));
      return;
    }

    const { error: subError } = await supabase
      .from("subscriptions")
      .update({ tier: plan, ...TIER_LIMITS[plan] })
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
      prev.map((u) => (u.user_id === userId ? { ...u, is_approved: true, tier: plan } : u))
    );
  };

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
      prev.map((u) => (u.user_id === userId ? { ...u, is_approved: false, tier: "free" } : u))
    );
  };

  const changeTier = async (userId: string, newTier: Tier) => {
    const updates: Record<string, unknown> = {
      tier: newTier,
      upgrade_requested: false,
      pending_tier: null,
      payment_reference: null,
      last_upgrade_request: null,
      ...TIER_LIMITS[newTier],
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
    const tier = pendingTier as Tier;
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
      return;
    }

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
  };

  const tierLabel = (tier: string) => {
    if (tier === "ultra") return t("settings.ultra");
    if (tier === "pro") return t("settings.pro");
    if (tier === "basic") return t("settings.basic");
    return t("settings.free");
  };

  return {
    users,
    loading,
    approveWithPlan,
    revokeApproval,
    changeTier,
    approveUpgrade,
    rejectUpgrade,
    tierLabel,
  };
}
