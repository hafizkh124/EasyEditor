// AI-verified payment receipt — renewal flow.
//
// Used by users who already have a tier and need to extend or restore access
// after grace/lapse. Same AI verification logic as verify-receipt, but the
// approved write extends expires_at rather than starting fresh.
import { createClient } from "npm:@supabase/supabase-js@2";
import { callChatCompletions } from "../_shared/aiGateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PaidTier = "basic" | "pro" | "ultra";

const TIER_PRICES_PKR: Record<PaidTier, number> = {
  basic: 1_400,
  pro:   5_400,
  ultra: 8_400,
};

const VALID_RECEIVERS = [
  "Al-Ulama", "Ulama Centre", "Hafiz Khizar Hayat",
  "PK04NBPA1997004243449556", "00420745",
  "03084164816", "0308 4164816", "0308-4164816",
];

const CONFIDENCE_THRESHOLD = 90;

interface AIResult {
  confidence: number;
  amount: number | null;
  receiver: string | null;
  txnId: string | null;
  date: string | null;
  tampered: boolean;
  reasons: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
  const userId = claimsData.claims.sub as string;

  let body: { referenceNo?: string; storagePath?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { referenceNo, storagePath } = body ?? {};
  if (!referenceNo || typeof referenceNo !== "string" || referenceNo.trim().length < 3) {
    return json({ error: "Invalid referenceNo" }, 400);
  }
  if (!storagePath || typeof storagePath !== "string" || !storagePath.startsWith(`${userId}/`)) {
    return json({ error: "Invalid storagePath" }, 400);
  }
  const cleanRef = referenceNo.trim();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Existing tier required for renewal
  const { data: sub } = await admin
    .from("subscriptions")
    .select("tier, expires_at, renewal_count, monthly_limit:transcription_limit")
    .eq("user_id", userId)
    .single();
  const tier = sub?.tier as PaidTier | undefined;
  if (!tier || !["basic","pro","ultra"].includes(tier)) {
    return json({ error: "No active plan to renew. Use a new subscription instead." }, 400);
  }

  // Replay-attack check
  const [{ data: subDup }, { data: payDup }] = await Promise.all([
    admin.from("subscriptions").select("user_id").eq("payment_reference", cleanRef).limit(1),
    admin.from("admin_payments").select("id").eq("payment_reference", cleanRef).limit(1),
  ]);
  if ((subDup?.length ?? 0) > 0 || (payDup?.length ?? 0) > 0) {
    return json({ error: "This transaction ID has already been used", code: "duplicate_reference" }, 409);
  }

  // Download receipt
  const { data: fileBlob, error: dlError } = await admin.storage.from("payment-receipts").download(storagePath);
  if (dlError || !fileBlob) return json({ error: "Could not read uploaded receipt" }, 400);
  const buf = new Uint8Array(await fileBlob.arrayBuffer());
  const base64 = btoa(String.fromCharCode(...buf));
  const mime = fileBlob.type || "image/jpeg";

  const hasAnyKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("LOVABLE_API_KEY");
  if (!hasAnyKey) return json({ error: "AI gateway not configured" }, 500);

  const expectedPkr = TIER_PRICES_PKR[tier];
  const ai = await verifyWithAI(base64, mime, expectedPkr);
  if (!ai) return json({ error: "AI verification temporarily unavailable" }, 503);

  const amountMatches = ai.amount !== null && Math.abs(ai.amount - expectedPkr) <= Math.max(50, expectedPkr * 0.02);
  const receiverMatches = ai.receiver !== null && VALID_RECEIVERS.some((r) =>
    ai.receiver!.toLowerCase().includes(r.toLowerCase()) ||
    r.toLowerCase().includes(ai.receiver!.toLowerCase()),
  );
  const passes = ai.confidence >= CONFIDENCE_THRESHOLD && amountMatches && receiverMatches && !ai.tampered;

  const aiDetails = {
    extracted: { amount: ai.amount, receiver: ai.receiver, txnId: ai.txnId, date: ai.date },
    expected: { amount_pkr: expectedPkr, plan: tier, kind: "renewal" },
    checks: { amount_matches: amountMatches, receiver_matches: receiverMatches, tampered: ai.tampered },
    confidence: ai.confidence,
    reasons: ai.reasons,
  };

  if (passes) {
    const now = new Date();
    const currentExpiry = sub?.expires_at ? new Date(sub.expires_at as string) : now;
    const base = currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
    const newExpiry = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { error: subErr } = await admin.from("subscriptions").update({
      payment_reference: cleanRef,
      payment_proof_url: storagePath,
      ai_verification_status: "auto_approved",
      ai_confidence_score: ai.confidence,
      ai_verification_details: aiDetails,
      expires_at: newExpiry.toISOString(),
      last_renewed_at: now.toISOString(),
      renewal_count: ((sub?.renewal_count as number | null) ?? 0) + 1,
      transcription_seconds_used: 0,
      tts_characters_used: 0,
      ocr_pages_used: 0,
      research_queries_used: 0,
      islamic_queries_used: 0,
    }).eq("user_id", userId);
    if (subErr) return json({ error: "Could not renew subscription", detail: subErr.message }, 500);

    // Reset monthly token balance
    await admin.rpc("credit_tokens", {
      p_user_id: userId,
      p_amount: 1, // placeholder — real reset below
      p_source: "monthly",
      p_action_type: "monthly_reset",
      p_detail: "Renewal monthly token reset",
    }).then(() => {/* no-op */}).catch(() => {/* tolerate */});
    // Direct wallet refresh (idempotent)
    await admin.from("token_wallets").update({
      monthly_balance: ((): number => {
        const map: Record<PaidTier, number> = { basic: 5_000, pro: 25_000, ultra: 50_000 };
        return map[tier];
      })(),
    }).eq("user_id", userId);

    await admin.from("admin_payments").insert({
      user_id: userId,
      amount_pkr: expectedPkr,
      payment_type: "renewal",
      payment_method: "manual_ai_verified",
      payment_reference: cleanRef,
      tier_at_payment: tier,
      notes: `Renewal AI auto-approved (confidence ${ai.confidence}%)`,
      recorded_by: userId,
    });

    await admin.from("notifications").insert({
      user_id: userId,
      title: "Subscription renewed",
      message: `Your ${tier.toUpperCase()} plan is renewed for another 30 days.`,
      is_read: false,
    });

    return json({ success: true, autoApproved: true, confidence: ai.confidence });
  }

  // Manual review
  await admin.from("subscriptions").update({
    upgrade_requested: true,
    pending_tier: tier,
    payment_reference: cleanRef,
    payment_proof_url: storagePath,
    ai_verification_status: "manual_review",
    ai_confidence_score: ai.confidence,
    ai_verification_details: aiDetails,
    last_upgrade_request: new Date().toISOString(),
  }).eq("user_id", userId);

  return json({ success: true, autoApproved: false, confidence: ai.confidence, reasons: ai.reasons });
});

async function verifyWithAI(base64: string, mime: string, expectedPkr: number, key: string): Promise<AIResult | null> {
  const systemPrompt = `You are a payment receipt verifier for an Islamic-research SaaS in Pakistan.
You receive an uploaded receipt image (bank, JazzCash, EasyPaisa). This is a RENEWAL receipt.
Valid receivers: Al-Ulama (NBP IBAN PK04NBPA1997004243449556), Ulama Centre (JazzCash Till 00420745),
Hafiz Khizar Hayat (JazzCash/EasyPaisa 0308 4164816).
Expected amount: ${expectedPkr} PKR (±2% or ±50 PKR tolerance).
Output JSON only:
{"confidence": <0-100>, "amount": <number|null>, "receiver": <string|null>, "txnId": <string|null>, "date": <string|null>, "tampered": <bool>, "reasons": <string[]>}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [
            { type: "text", text: `Verify this renewal receipt for ${expectedPkr} PKR.` },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ] },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.error("[verify-renewal-receipt] AI gateway error", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as Partial<AIResult>;
    return {
      confidence: clampInt(parsed.confidence, 0, 100),
      amount: typeof parsed.amount === "number" ? parsed.amount : null,
      receiver: typeof parsed.receiver === "string" ? parsed.receiver : null,
      txnId: typeof parsed.txnId === "string" ? parsed.txnId : null,
      date: typeof parsed.date === "string" ? parsed.date : null,
      tampered: !!parsed.tampered,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 8).map(String) : [],
    };
  } catch (e) {
    console.error("[verify-renewal-receipt] AI call threw", e);
    return null;
  }
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" ? Math.round(v) : 0;
  return Math.min(max, Math.max(min, n));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
