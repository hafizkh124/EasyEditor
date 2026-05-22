import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { TIER_LIMITS, TOKEN_ALLOCATIONS } from "@/contexts/SubscriptionContext";
import type { UserRow, PaidTier, Tier } from "@/components/admin/types";
import { REFERRAL_CREDIT_AMOUNT } from "@/lib/referral";

const sendNotification = (userId: string, title: string, message: string) =>
  supabase.from("notifications").insert({ user_id: userId, title, message });

export function useAdminUsers(enabled: boolean) {
  const { t } = useLanguage();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, is_approved, created_at, rejection_status, rejection_reason, rejected_at, referral_code, referred_by, referral_credits, whatsapp_number, country, profession")
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
            referral_code?: string | null;
            referred_by?: string | null;
            referral_credits?: number | null;
            whatsapp_number?: string | null;
            country?: string | null;
            profession?: string | null;
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
            referral_code: profileWithRejection.referral_code ?? null,
            referred_by: profileWithRejection.referred_by ?? null,
            referral_credits: profileWithRejection.referral_credits ?? 0,
            whatsapp_number: profileWithRejection.whatsapp_number ?? null,
            country: profileWithRejection.country ?? null,
            profession: profileWithRejection.profession ?? null,
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

    // Admins / team members never expire. Check role and write NULL expiry if so.
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    const targetIsAdmin = !!roleRow;
    const expiresAtIso = targetIsAdmin ? null : expiresAt.toISOString();

    const { error: subError } = await supabase
      .from("subscriptions")
      .update({
        tier: plan,
        ...TIER_LIMITS[plan],
        activated_at: now.toISOString(),
        expires_at: expiresAtIso,
      })
      .eq("user_id", userId);

    if (subError) {
      if (import.meta.env.DEV)
        console.error("[Admin] subscriptions PATCH failed →", subError.code, subError.message, subError.details);
      toast.error(`${t("admin.update_error")}: ${subError.message}`);
      return;
    }

    // Set token wallet for the approved plan
    const tokenAllocation = TOKEN_ALLOCATIONS[plan] ?? 0;
    const { error: walletError } = await supabase
      .from("token_wallets")
      .upsert({
        user_id: userId,
        monthly_balance: tokenAllocation,
        topup_balance: 0,
        monthly_limit: tokenAllocation,
      }, { onConflict: "user_id" });
    if (walletError && import.meta.env.DEV) {
      console.warn("[Admin] token wallet upsert warning:", walletError.message);
    }

    await sendNotification(
      userId,
      t("notification.account_approved_title"),
      t("notification.account_approved_msg").replace("{plan}", plan.toUpperCase())
    );

    // Grant referral credit if this user was referred. Idempotent via the
    // UNIQUE(referrer_id, referee_id) constraint on referral_events: a second
    // approve after a revoke won't double-credit. Failures are non-fatal —
    // approval has already succeeded.
    try {
      const { data: refRow } = await supabase
        .from("profiles")
        .select("referred_by")
        .eq("user_id", userId)
        .single();
      const referrerId = (refRow as { referred_by?: string | null } | null)?.referred_by;
      if (referrerId) {
        const { error: eventErr } = await supabase
          .from("referral_events")
          .insert({
            referrer_id: referrerId,
            referee_id: userId,
            credits_granted: REFERRAL_CREDIT_AMOUNT,
          });
        // 23505 = unique violation → already granted. Treat as success.
        const isUniqueViolation = eventErr && (eventErr as { code?: string }).code === "23505";
        if (!eventErr) {
          // Increment the referrer's credit balance.
          const { data: refProfile } = await supabase
            .from("profiles")
            .select("referral_credits")
            .eq("user_id", referrerId)
            .single();
          const current = (refProfile as { referral_credits?: number | null } | null)?.referral_credits ?? 0;
          await supabase
            .from("profiles")
            .update({ referral_credits: current + REFERRAL_CREDIT_AMOUNT })
            .eq("user_id", referrerId);
          await sendNotification(
            referrerId,
            t("notification.referral_earned_title") || "Referral credits earned",
            (t("notification.referral_earned_msg") || "You earned {n} credits for referring a new subscriber.").replace(
              "{n}",
              String(REFERRAL_CREDIT_AMOUNT),
            ),
          );
        } else if (!isUniqueViolation && import.meta.env.DEV) {
          console.warn("[Admin] referral_events insert error:", eventErr);
        }
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn("[Admin] referral grant skipped:", e);
    }

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
              expires_at: expiresAtIso,
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

    // Admins never expire — renewing clears any leftover expiry date.
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    const targetIsAdmin = !!roleRow;

    const cycleDays = sub?.billing_cycle_days ?? 30;
    const now = new Date();
    const baseExpiry = sub?.expires_at ? new Date(sub.expires_at) : now;
    const startFrom = baseExpiry.getTime() > now.getTime() ? baseExpiry : now;
    const newExpiry = targetIsAdmin
      ? null
      : new Date(startFrom.getTime() + cycleDays * 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from("subscriptions")
      .update({
        expires_at: newExpiry ? newExpiry.toISOString() : null,
        last_renewed_at: now.toISOString(),
        renewal_count: (sub?.renewal_count ?? 0) + 1,
      })
      .eq("user_id", userId);

    if (error) {
      toast.error(`${t("admin.update_error")}: ${error.message}`);
      return;
    }

    // Reset monthly tokens to monthly_limit on renewal
    const { data: wallet } = await supabase
      .from("token_wallets")
      .select("monthly_limit")
      .eq("user_id", userId)
      .single();
    if (wallet) {
      await supabase
        .from("token_wallets")
        .update({ monthly_balance: (wallet as { monthly_limit: number }).monthly_limit })
        .eq("user_id", userId);
    }

    await sendNotification(
      userId,
      t("notification.subscription_renewed_title") || "Subscription renewed",
      newExpiry
        ? (t("notification.subscription_renewed_msg") || "Your subscription has been renewed. New expiry: {date}").replace(
            "{date}",
            newExpiry.toLocaleDateString(),
          )
        : (t("notification.subscription_no_expiry") || "Your subscription is active with no expiry."),
    );

    toast.success(t("admin.renewed_done") || "Subscription renewed");
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === userId
          ? {
              ...u,
              expires_at: newExpiry ? newExpiry.toISOString() : null,
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

    // Zero monthly tokens but preserve topup_balance
    await supabase
      .from("token_wallets")
      .update({ monthly_balance: 0, monthly_limit: 0 })
      .eq("user_id", userId);

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

    // Update token wallet for new tier (preserve topup_balance)
    const tokenAllocation = TOKEN_ALLOCATIONS[newTier] ?? 0;
    await supabase
      .from("token_wallets")
      .upsert({
        user_id: userId,
        monthly_balance: tokenAllocation,
        monthly_limit: tokenAllocation,
      }, { onConflict: "user_id" });

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

  /** Manually adjust a user's token balance (credit or debit). */
  const adjustTokens = async (userId: string, amount: number, reason: string) => {
    const actionType = amount >= 0 ? "admin_adjust" : "admin_adjust";
    const source = "topup"; // Manual adjustments go to topup pool (persistent)

    const { data, error } = await supabase.rpc("credit_tokens", {
      p_user_id: userId,
      p_amount: amount,
      p_source: source,
      p_action_type: actionType,
      p_detail: reason || "Admin manual adjustment",
    });

    if (error) {
      toast.error(`Token adjustment failed: ${error.message}`);
      return;
    }

    toast.success(`Tokens adjusted: ${amount > 0 ? "+" : ""}${amount}`);
  };

  /** Approve a pending top-up request. */
  const approveTopup = async (requestId: string) => {
    const { data: { user: adminUser } } = await supabase.auth.getUser();

    // Get the request details
    const { data: req, error: fetchErr } = await supabase
      .from("topup_requests")
      .select("user_id, token_amount, status")
      .eq("id", requestId)
      .single();

    if (fetchErr || !req) {
      toast.error("Top-up request not found");
      return;
    }
    if ((req as any).status !== "pending") {
      toast.error("Request already processed");
      return;
    }

    // Credit the tokens
    const { error: creditErr } = await supabase.rpc("credit_tokens", {
      p_user_id: (req as any).user_id,
      p_amount: (req as any).token_amount,
      p_source: "topup",
      p_action_type: "topup",
      p_detail: `Top-up approved (request ${requestId})`,
    });

    if (creditErr) {
      toast.error(`Failed to credit tokens: ${creditErr.message}`);
      return;
    }

    // Mark request as approved
    await supabase
      .from("topup_requests")
      .update({
        status: "approved",
        reviewed_by: adminUser?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    await sendNotification(
      (req as any).user_id,
      "Top-up approved",
      `Your top-up of ${(req as any).token_amount} tokens has been approved and credited to your account.`,
    );

    toast.success("Top-up approved and tokens credited");
  };

  /** Reject a pending top-up request. */
  const rejectTopup = async (requestId: string) => {
    const { data: { user: adminUser } } = await supabase.auth.getUser();

    const { data: req } = await supabase
      .from("topup_requests")
      .select("user_id")
      .eq("id", requestId)
      .single();

    await supabase
      .from("topup_requests")
      .update({
        status: "rejected",
        reviewed_by: adminUser?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (req) {
      await sendNotification(
        (req as any).user_id,
        "Top-up rejected",
        "Your top-up request has been rejected. Please contact admin for more information.",
      );
    }

    toast.success("Top-up request rejected");
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
    adjustTokens,
    approveTopup,
    rejectTopup,
    tierLabel,
  };
}
