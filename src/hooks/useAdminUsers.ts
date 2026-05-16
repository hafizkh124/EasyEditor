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
      .select("user_id, display_name, is_approved, created_at, rejection_status, rejection_reason, rejected_at")
      .order("created_at", { ascending: false });

    const { data: subs } = await supabase
      .from("subscriptions")
      .select("user_id, tier, upgrade_requested, pending_tier, payment_reference, last_upgrade_request, activated_at, expires_at, last_renewed_at, renewal_count, billing_cycle_days");

    if (profiles) {
      const subMap = new Map((subs || []).map((s) => [s.user_id, s]));
      setUsers(
        profiles.map((p) => {
          const profileWithRejection = p as typeof p & {
            rejection_status?: string | null;
            rejection_reason?: string | null;
            rejected_at?: string | null;
          };
          const sub = subMap.get(p.user_id) as
            | (NonNullable<typeof subs>[number] & {
                activated_at?: string | null;
                expires_at?: string | null;
                last_renewed_at?: string | null;
                renewal_count?: number | null;
                billing_cycle_days?: number | null;
              })
            | undefined;
          return {
            user_id: p.user_id,
            display_name: p.display_name,
            is_approved: p.is_approved,
            created_at: p.created_at,
            tier: sub?.tier || "free",
            upgrade_requested: sub?.upgrade_requested || false,
            pending_tier: sub?.pending_tier || null,
            payment_reference: sub?.payment_reference || null,
            last_upgrade_request: sub?.last_upgrade_request || null,
            rejection_status: profileWithRejection.rejection_status ?? null,
            rejection_reason: profileWithRejection.rejection_reason ?? null,
            rejected_at: profileWithRejection.rejected_at ?? null,
            activated_at: sub?.activated_at ?? null,
            expires_at: sub?.expires_at ?? null,
            last_renewed_at: sub?.last_renewed_at ?? null,
            renewal_count: sub?.renewal_count ?? 0,
            billing_cycle_days: sub?.billing_cycle_days ?? 30,
          };
        })
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    if (enabled) fetchUsers();
  }, [enabled]);

  const approveWithPlan = async (userId: string, plan: PaidTier) => {
    // Clears any prior rejection state — admin may approve a previously rejected user.
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        is_approved: true,
        rejection_status: null,
        rejection_reason: null,
        rejected_at: null,
        rejected_by: null,
      })
      .eq("user_id", userId);

    if (profileError) {
      toast.error(t("admin.update_error"));
      return;
    }

    // Read current billing_cycle_days so admins can customize per-user cycles later.
    const { data: currentSub } = await supabase
      .from("subscriptions")
      .select("billing_cycle_days")
      .eq("user_id", userId)
      .single();
    const cycleDays = (currentSub as { billing_cycle_days?: number | null } | null)?.billing_cycle_days ?? 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + cycleDays * 24 * 60 * 60 * 1000);

    const { error: subError } = await supabase
      .from("subscriptions")
      .update({
        tier: plan,
        ...TIER_LIMITS[plan],
        activated_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
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
        u.user_id === userId
          ? {
              ...u,
              is_approved: true,
              tier: plan,
              rejection_status: null,
              rejection_reason: null,
              rejected_at: null,
              activated_at: now.toISOString(),
              expires_at: expiresAt.toISOString(),
            }
          : u,
      ),
    );
  };

  const renewSubscription = async (userId: string) => {
    // Greatest() handles both early renewals (extend from current expiry)
    // and post-expiry renewals (extend from today).
    const { data: current } = await supabase
      .from("subscriptions")
      .select("expires_at, billing_cycle_days, renewal_count")
      .eq("user_id", userId)
      .single();

    const sub = current as {
      expires_at?: string | null;
      billing_cycle_days?: number | null;
      renewal_count?: number | null;
    } | null;

    const cycleDays = sub?.billing_cycle_days ?? 30;
    const now = new Date();
    const baseExpiry = sub?.expires_at ? new Date(sub.expires_at) : now;
    const startFrom = baseExpiry.getTime() > now.getTime() ? baseExpiry : now;
    const newExpiry = new Date(startFrom.getTime() + cycleDays * 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from("subscriptions")
      .update({
        expires_at: newExpiry.toISOString(),
        last_renewed_at: now.toISOString(),
        renewal_count: (sub?.renewal_count ?? 0) + 1,
      })
      .eq("user_id", userId);

    if (error) {
      toast.error(`${t("admin.update_error")}: ${error.message}`);
      return;
    }

    await sendNotification(
      userId,
      t("notification.subscription_renewed_title") || "Subscription renewed",
      (t("notification.subscription_renewed_msg") || "Your subscription has been renewed. New expiry: {date}").replace(
        "{date}",
        newExpiry.toLocaleDateString(),
      ),
    );

    toast.success(t("admin.renewed_done") || "Subscription renewed");
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === userId
          ? {
              ...u,
              expires_at: newExpiry.toISOString(),
              last_renewed_at: now.toISOString(),
              renewal_count: (u.renewal_count ?? 0) + 1,
            }
          : u,
      ),
    );
  };

  const rejectUser = async (userId: string, reason: string) => {
    const trimmedReason = reason.trim() || null;
    const { data: { user: adminUser } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("profiles")
      .update({
        is_approved: false,
        rejection_status: "rejected",
        rejection_reason: trimmedReason,
        rejected_at: new Date().toISOString(),
        rejected_by: adminUser?.id ?? null,
      })
      .eq("user_id", userId);

    if (error) {
      toast.error(`${t("admin.update_error")}: ${error.message}`);
      return;
    }

    await sendNotification(
      userId,
      t("notification.account_rejected_title") || "Account rejected",
      trimmedReason
        ? (t("notification.account_rejected_msg_with_reason") || "Your account was rejected. Reason: {reason}").replace("{reason}", trimmedReason)
        : (t("notification.account_rejected_msg") || "Your account registration has been rejected. Please contact the admin if you believe this is a mistake."),
    );

    toast.success(t("admin.rejected_done") || "User rejected");
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === userId
          ? {
              ...u,
              is_approved: false,
              rejection_status: "rejected",
              rejection_reason: trimmedReason,
              rejected_at: new Date().toISOString(),
            }
          : u,
      ),
    );
  };

  const unrejectUser = async (userId: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({
        rejection_status: null,
        rejection_reason: null,
        rejected_at: null,
        rejected_by: null,
      })
      .eq("user_id", userId);

    if (error) {
      toast.error(`${t("admin.update_error")}: ${error.message}`);
      return;
    }

    toast.success(t("admin.unrejected_done") || "Returned to pending queue");
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === userId
          ? { ...u, rejection_status: null, rejection_reason: null, rejected_at: null }
          : u,
      ),
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
      .update({
        tier: "free",
        ...TIER_LIMITS.free,
        activated_at: null,
        expires_at: null,
        last_renewed_at: null,
      })
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
        u.user_id === userId
          ? {
              ...u,
              is_approved: false,
              tier: "free",
              activated_at: null,
              expires_at: null,
              last_renewed_at: null,
            }
          : u,
      ),
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
    rejectUser,
    unrejectUser,
    renewSubscription,
    changeTier,
    approveUpgrade,
    rejectUpgrade,
    tierLabel,
  };
}
