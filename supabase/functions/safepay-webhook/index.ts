// SafePay webhook handler — verifies HMAC signature, then activates subscriptions
// or credits token top-ups based on the metadata recorded at session creation.
import { createClient } from "npm:@supabase/supabase-js@2";

const TIER_LIMITS: Record<string, Record<string, number>> = {
  basic: { transcription_limit: 1800,  tts_character_limit: 0,      ocr_pages_limit: 30,   research_queries_limit: 20,  islamic_queries_limit: 10  },
  pro:   { transcription_limit: 18000, tts_character_limit: 0,      ocr_pages_limit: 300,  research_queries_limit: 200, islamic_queries_limit: 100 },
  ultra: { transcription_limit: 36000, tts_character_limit: 500000, ocr_pages_limit: 2000, research_queries_limit: 500, islamic_queries_limit: 500 },
};
const TOKEN_ALLOCATIONS: Record<string, number> = { basic: 5000, pro: 25000, ultra: 50000 };
const BILLING_CYCLE_DAYS = 30;

let _sb: ReturnType<typeof createClient> | null = null;
function sb() {
  if (!_sb) {
    _sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return _sb;
}

/** Verify SafePay HMAC signature: sha256=hex(HMAC(base64Decode(secret), `${ts}.${body}`)) */
async function verifySignature(rawBody: string, sig: string, ts: string, secretB64: string): Promise<boolean> {
  if (!sig || !ts || !secretB64) return false;
  try {
    const keyBytes = Uint8Array.from(atob(secretB64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const data = new TextEncoder().encode(`${ts}.${rawBody}`);
    const macBuf = await crypto.subtle.sign("HMAC", key, data);
    const hex = Array.from(new Uint8Array(macBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    const expected = `sha256=${hex}`;
    // Constant-time compare
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
  } catch (e) {
    console.error("[safepay-webhook] sig verify error:", e);
    return false;
  }
}

async function handleSubscriptionPayment(userId: string, tier: string, amount: number, ref: string, env: string) {
  const limits = TIER_LIMITS[tier];
  if (!limits) {
    console.warn("[safepay-webhook] unknown tier:", tier);
    return;
  }
  const tokens = TOKEN_ALLOCATIONS[tier] ?? 0;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + BILLING_CYCLE_DAYS * 24 * 60 * 60 * 1000);

  await sb().from("profiles").update({
    is_approved: true,
    rejection_status: null,
    rejection_reason: null,
    rejected_at: null,
    rejected_by: null,
  }).eq("user_id", userId);

  await sb().from("subscriptions").update({
    tier,
    ...limits,
    activated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    payment_source: "safepay",
    payment_reference: ref,
    environment: env,
    cancel_at_period_end: false,
    upgrade_requested: false,
    pending_tier: null,
    updated_at: now.toISOString(),
  }).eq("user_id", userId);

  await sb().from("token_wallets").upsert({
    user_id: userId,
    monthly_balance: tokens,
    monthly_limit: tokens,
    topup_balance: 0,
  }, { onConflict: "user_id" });

  await sb().from("admin_payments").insert({
    user_id: userId,
    amount_pkr: amount,
    payment_type: "subscription",
    payment_method: "safepay",
    payment_reference: ref,
    tier_at_payment: tier,
    notes: `SafePay ${env} — Rs ${amount}`,
    recorded_by: userId,
  });

  await sb().from("notifications").insert({
    user_id: userId,
    title: "Subscription activated",
    message: `Your ${tier.toUpperCase()} plan is now active. Welcome!`,
  });
}

async function handleTopupPayment(userId: string, tokens: number, amount: number, ref: string, env: string) {
  await sb().rpc("credit_tokens", {
    p_user_id: userId,
    p_amount: tokens,
    p_source: "topup",
    p_action_type: "topup_safepay",
    p_detail: `SafePay top-up (tx ${ref})`,
  });

  await sb().from("admin_payments").insert({
    user_id: userId,
    amount_pkr: amount,
    payment_type: "topup",
    payment_method: "safepay",
    payment_reference: ref,
    notes: `SafePay ${env} — ${tokens} tokens — Rs ${amount}`,
    recorded_by: userId,
  });

  await sb().from("notifications").insert({
    user_id: userId,
    title: "Tokens credited",
    message: `${tokens.toLocaleString()} tokens have been added to your account.`,
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await req.text();
  const sig = req.headers.get("X-SFPY-SIGNATURE") || req.headers.get("x-sfpy-signature") || "";
  const ts  = req.headers.get("X-SFPY-TIMESTAMP") || req.headers.get("x-sfpy-timestamp") || "";
  const secret = Deno.env.get("SAFEPAY_WEBHOOK_SECRET");

  if (secret) {
    const ok = await verifySignature(rawBody, sig, ts, secret);
    if (!ok) {
      console.warn("[safepay-webhook] invalid signature");
      return new Response("Invalid signature", { status: 401 });
    }
  } else {
    console.warn("[safepay-webhook] SAFEPAY_WEBHOOK_SECRET not set — skipping verification");
  }

  let evt: any;
  try { evt = JSON.parse(rawBody); } catch { return new Response("Bad JSON", { status: 400 }); }

  // SafePay sends different envelope shapes; normalize.
  const eventType: string = evt?.type || evt?.event || evt?.notification_type || "";
  const payload = evt?.data || evt?.payload || evt;
  const env = (Deno.env.get("SAFEPAY_ENV") || "sandbox");

  // Treat any of these as successful payment
  const success = /payment\.(completed|succeeded|authorized)/i.test(eventType);
  if (!success) {
    console.log("[safepay-webhook] ignoring event:", eventType);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  try {
    // Extract tracker + amount from various possible shapes
    const trackerId: string =
      payload?.tracker?.token || payload?.tracker_id || payload?.token || payload?.id || "";
    const amount = Number(
      payload?.tracker?.purchase_totals?.base_amount?.amount ??
      payload?.amount ??
      0,
    );

    if (!trackerId) {
      console.warn("[safepay-webhook] no tracker token in payload");
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // Look up the pending intent we stored at checkout creation
    const { data: pending, error: lookupErr } = await sb()
      .from("safepay_pending_checkouts")
      .select("*")
      .eq("tracker_token", trackerId)
      .maybeSingle();
    if (lookupErr || !pending) {
      console.warn("[safepay-webhook] no pending record for tracker:", trackerId, lookupErr);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
    if (pending.consumed_at) {
      console.log("[safepay-webhook] already consumed:", trackerId);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    const userId = pending.user_id as string;
    const paidAmount = amount || pending.amount_pkr;

    if (pending.kind === "subscription" && pending.tier) {
      await handleSubscriptionPayment(userId, pending.tier, paidAmount, trackerId, env);
    } else if (pending.kind === "topup" && pending.tokens) {
      await handleTopupPayment(userId, Number(pending.tokens), paidAmount, trackerId, env);
    } else {
      console.warn("[safepay-webhook] unknown pending shape:", pending);
    }

    await sb()
      .from("safepay_pending_checkouts")
      .update({ consumed_at: new Date().toISOString() })
      .eq("tracker_token", trackerId);

    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[safepay-webhook] handler error:", e);
    return new Response("Handler error", { status: 500 });
  }
});
