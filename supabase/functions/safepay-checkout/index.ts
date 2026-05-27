// Creates a SafePay hosted-checkout session and returns the redirect URL.
// Auth: requires logged-in user (JWT). Body: { kind, tier?, topupKey? }.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SAFEPAY_SECRET = Deno.env.get("SAFEPAY_SECRET_KEY")!;
const SAFEPAY_PUBLIC = Deno.env.get("SAFEPAY_API_KEY")!;
// Sandbox by default. Override with SAFEPAY_ENV=production for live.
const SAFEPAY_ENV = (Deno.env.get("SAFEPAY_ENV") || "sandbox") as "sandbox" | "production";
const SAFEPAY_HOST = SAFEPAY_ENV === "production"
  ? "https://api.getsafepay.com"
  : "https://sandbox.api.getsafepay.com";

// Plan & top-up catalogue (PKR, whole rupees).
const PLAN_PRICES: Record<string, { amount: number; tier: string }> = {
  basic: { amount: 1400, tier: "basic" },
  pro:   { amount: 5400, tier: "pro" },
  ultra: { amount: 8400, tier: "ultra" },
};
const TOPUP_PRICES: Record<string, { amount: number; tokens: number }> = {
  small:  { amount: 850,  tokens: 2_500 },
  medium: { amount: 2800, tokens: 10_000 },
  large:  { amount: 5600, tokens: 25_000 },
};

async function safepayPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${SAFEPAY_HOST}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SFPY-MERCHANT-SECRET": SAFEPAY_SECRET,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SafePay ${path} failed [${res.status}]: ${text}`);
  return text ? JSON.parse(text) : {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    if (!SAFEPAY_SECRET || !SAFEPAY_PUBLIC) {
      throw new Error("SafePay keys are not configured");
    }

    // Authenticate caller
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Missing authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) throw new Error("Not authenticated");
    const user = userData.user;

    const { kind, tier, topupKey, origin } = await req.json() as {
      kind: "subscription" | "topup";
      tier?: keyof typeof PLAN_PRICES;
      topupKey?: keyof typeof TOPUP_PRICES;
      origin?: string;
    };

    let amount: number;
    let tokens: number | null = null;
    let resolvedTier: string | null = null;
    let resolvedTopupKey: string | null = null;
    if (kind === "subscription") {
      const plan = tier && PLAN_PRICES[tier];
      if (!plan) throw new Error("Invalid tier");
      amount = plan.amount;
      resolvedTier = plan.tier;
    } else if (kind === "topup") {
      const pack = topupKey && TOPUP_PRICES[topupKey];
      if (!pack) throw new Error("Invalid topup pack");
      amount = pack.amount;
      tokens = pack.tokens;
      resolvedTopupKey = topupKey!;
    } else {
      throw new Error("Invalid kind");
    }

    // 1) Create payment session (tracker) — SafePay rejects unknown metadata keys,
    //    so we do NOT send metadata here; instead we persist a pending record
    //    keyed by tracker token and the webhook looks it up.
    const sessionRes = await safepayPost("/order/payments/v3/", {
      merchant_api_key: SAFEPAY_PUBLIC,
      intent: "CYBERSOURCE",
      mode: "payment",
      currency: "PKR",
      amount,
    });
    const trackerToken: string = sessionRes?.data?.tracker?.token;
    if (!trackerToken) throw new Error(`No tracker in response: ${JSON.stringify(sessionRes)}`);

    // Persist intent so the webhook can credit the correct account.
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error: insErr } = await serviceClient.from("safepay_pending_checkouts").insert({
      tracker_token: trackerToken,
      user_id: user.id,
      kind,
      tier: resolvedTier,
      topup_key: resolvedTopupKey,
      tokens,
      amount_pkr: amount,
    });
    if (insErr) console.error("[safepay-checkout] could not persist pending:", insErr);


    // 2) Create auth token (passport)
    const passportRes = await safepayPost("/client/passport/v1/token", {});
    const tbt: string = passportRes?.data;
    if (!tbt) throw new Error(`No passport token in response`);

    // 3) Build hosted checkout URL
    const baseOrigin = origin || req.headers.get("origin") || "";
    const params = new URLSearchParams({
      env: SAFEPAY_ENV,
      beacon: trackerToken,
      tbt,
      source: "hosted",
      redirect_url: `${baseOrigin}/checkout/success?tracker=${trackerToken}`,
      cancel_url: `${baseOrigin}/pricing?cancelled=1`,
    });
    const checkoutUrl = `${SAFEPAY_HOST}/embedded/?${params.toString()}`;

    return new Response(JSON.stringify({ checkoutUrl, tracker: trackerToken }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[safepay-checkout]", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
