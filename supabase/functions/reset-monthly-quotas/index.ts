/**
 * reset-monthly-quotas — Scheduled edge function
 *
 * Token system (v3): Calls `reset_monthly_tokens` RPC which:
 *   1. Calculates 15% bonus from unused monthly tokens → topup pool
 *   2. Resets monthly_balance to monthly_limit for all active paid users
 *   3. Resets legacy *_used columns to 0 for backward compat analytics
 *
 * Also purges expired cache entries.
 *
 * Schedule via Supabase Dashboard → Edge Functions → Schedule:
 *   Cron: 0 0 1 * *  (midnight UTC on 1st of every month)
 *
 * Or invoke manually:
 *   supabase functions invoke reset-monthly-quotas
 *
 * Security: only callable with service_role key (no user auth required).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl     = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate caller — must be service_role
    const authHeader   = req.headers.get("Authorization") ?? "";
    const providedKey  = authHeader.replace("Bearer ", "").trim();

    // Allow invocation via cron (no auth header) only from internal Supabase infra,
    // or via service_role key for manual invocations.
    if (providedKey && providedKey !== serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── 1. Reset monthly tokens + calculate bonuses ──────────────────────────
    // The RPC handles: bonus calculation (15% of unused monthly → topup),
    // monthly_balance reset to monthly_limit, and legacy *_used column resets.
    const { data: tokenResetCount, error: tokenResetErr } = await supabase
      .rpc("reset_monthly_tokens", { p_bonus_rate: 0.15 });

    if (tokenResetErr) {
      console.error("[reset-monthly-quotas] reset_monthly_tokens RPC error:", tokenResetErr);
      return new Response(
        JSON.stringify({ error: "Failed to reset monthly tokens", details: tokenResetErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Also call legacy reset_monthly_quotas for any remaining old counters
    const { data: legacyResetCount, error: legacyResetErr } = await supabase
      .rpc("reset_monthly_quotas");

    if (legacyResetErr) {
      // Non-fatal: token reset already succeeded
      console.warn("[reset-monthly-quotas] legacy reset_monthly_quotas warning:", legacyResetErr.message);
    }

    // ── 3. Purge expired cache entries ────────────────────────────────────────
    const { data: purgeCount, error: purgeErr } = await supabase
      .rpc("purge_expired_cache");

    if (purgeErr) {
      // Non-fatal: log but don't fail the reset
      console.warn("[reset-monthly-quotas] purge_expired_cache error:", purgeErr.message);
    }

    const result = {
      success:              true,
      token_users_reset:    tokenResetCount ?? 0,
      legacy_users_reset:   legacyResetCount ?? 0,
      cache_purged:         purgeCount ?? 0,
      reset_at:             new Date().toISOString(),
    };

    console.log("[reset-monthly-quotas] Completed:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[reset-monthly-quotas] Unexpected error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
