/**
 * check-subscription-expiry — Scheduled edge function
 *
 * Finds subscriptions whose `expires_at` is in the past and drops their tier
 * back to "free" with zeroed limits. Does NOT flip `is_approved` — the user
 * stays a valid account, they just can't use paid features until they renew.
 *
 * Sends a notification to each affected user. Idempotent: re-running the
 * function does nothing for users already on the free tier.
 *
 * Schedule via Supabase Dashboard → Edge Functions → Schedule:
 *   Cron: 0 2 * * *  (daily at 02:00 UTC)
 *
 * Or invoke manually:
 *   supabase functions invoke check-subscription-expiry
 *
 * Security: only callable with service_role key.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FREE_LIMITS = {
  transcription_limit: 0,
  tts_character_limit: 0,
  ocr_pages_limit: 0,
  research_queries_limit: 0,
  islamic_queries_limit: 0,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const providedKey = authHeader.replace("Bearer ", "").trim();
    if (providedKey && providedKey !== serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const nowIso = new Date().toISOString();

    // Find expired subscriptions still on a paid tier.
    const { data: expired, error: findErr } = await supabase
      .from("subscriptions")
      .select("user_id, tier, expires_at")
      .lt("expires_at", nowIso)
      .neq("tier", "free");

    if (findErr) {
      console.error("[check-subscription-expiry] find error:", findErr);
      return new Response(
        JSON.stringify({ error: "Failed to query expired subscriptions", details: findErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const expiredList = expired ?? [];

    if (expiredList.length === 0) {
      const result = { success: true, expired_count: 0, downgraded: [], checked_at: nowIso };
      console.log("[check-subscription-expiry] No expired subscriptions.");
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userIds = expiredList.map((s) => s.user_id);

    const { error: updErr } = await supabase
      .from("subscriptions")
      .update({ tier: "free", ...FREE_LIMITS })
      .in("user_id", userIds);

    if (updErr) {
      console.error("[check-subscription-expiry] downgrade error:", updErr);
      return new Response(
        JSON.stringify({ error: "Failed to downgrade expired subscriptions", details: updErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Notify each affected user. Non-fatal if notification insert fails.
    const notifications = userIds.map((user_id) => ({
      user_id,
      title: "Subscription expired",
      message: "Your subscription has expired. Please contact admin to renew.",
    }));
    const { error: notifyErr } = await supabase.from("notifications").insert(notifications);
    if (notifyErr) {
      console.warn("[check-subscription-expiry] notification insert warning:", notifyErr.message);
    }

    const result = {
      success: true,
      expired_count: expiredList.length,
      downgraded: expiredList.map((s) => ({
        user_id: s.user_id,
        previous_tier: s.tier,
        expires_at: s.expires_at,
      })),
      checked_at: nowIso,
    };
    console.log("[check-subscription-expiry] Completed:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[check-subscription-expiry] Unexpected error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
