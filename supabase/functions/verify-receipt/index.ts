// AI-verified payment receipt — new activation.
//
// Workflow:
//   1. Validate JWT, parse body
//   2. Replay-attack check on payment_reference
//   3. Download receipt from storage as base64
//   4. Call Lovable AI Gateway (Gemini) with vision + JSON output
//   5. If confidence >= 90% AND amount/receiver checks pass → auto-activate
//      (set tier, activated_at, expires_at, ai_verification_status='auto_approved',
//       allocate tokens, log admin_payments, notify user)
//   6. Otherwise → flag for manual review (upgrade_requested=true,
//      ai_verification_status='manual_review')
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callChatCompletions } from "../_shared/aiGateway.ts";
// The auto-approval decision, the tier prices and the receiver allowlist now
// live in one tested module shared with verify-renewal-receipt. They used to be
// duplicated verbatim in both files with nothing checking that the copies
// agreed. See src/test/receiptDecision.test.ts.
import {
  decideActivation,
  TIER_PRICES_PKR,
  type PaidTier,
} from "../_shared/receiptDecision.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIER_LIMITS: Record<PaidTier, {
  transcription_limit: number;
  tts_character_limit: number;
  ocr_pages_limit: number;
  research_queries_limit: number;
  islamic_queries_limit: number;
}> = {
  basic: { transcription_limit: 1_800,  tts_character_limit: 0,       ocr_pages_limit: 30,    research_queries_limit: 20,  islamic_queries_limit: 10 },
  pro:   { transcription_limit: 18_000, tts_character_limit: 0,       ocr_pages_limit: 300,   research_queries_limit: 200, islamic_queries_limit: 100 },
  ultra: { transcription_limit: 36_000, tts_character_limit: 500_000, ocr_pages_limit: 2_000, research_queries_limit: 500, islamic_queries_limit: 500 },
};

const TIER_TOKENS: Record<PaidTier, number> = {
  basic: 5_000,
  pro:   25_000,
  ultra: 50_000,
};

interface VerifyRequest {
  planId: PaidTier;
  referenceNo: string;
  storagePath: string;
}

interface AIResult {
  confidence: number;
  amount: number | null;
  receiver: string | null;
  txnId: string | null;
  date: string | null;
  tampered: boolean;
  reasons: string[];
}

/**
 * Exported so the request logic is reachable from a test. Everything below
 * used to live inside an anonymous `serve(async (req) => …)`, which left the
 * HTTP layer — validation, auth rejection, error mapping, CORS on error
 * responses — verifiable only by the post-deploy smoke script.
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── 1. Auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
  const userId = claimsData.claims.sub as string;

  // ── 2. Parse body
  let body: VerifyRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const { planId, referenceNo, storagePath } = body ?? {};
  if (!planId || !["basic", "pro", "ultra"].includes(planId)) {
    return json({ error: "Invalid planId" }, 400);
  }
  if (!referenceNo || typeof referenceNo !== "string" || referenceNo.trim().length < 3) {
    return json({ error: "Invalid referenceNo" }, 400);
  }
  if (!storagePath || typeof storagePath !== "string" || !storagePath.startsWith(`${userId}/`)) {
    return json({ error: "Invalid storagePath" }, 400);
  }

  const cleanRef = referenceNo.trim();
  const expectedPkr = TIER_PRICES_PKR[planId];

  // ── 3. Service-role client (DB writes + storage download)
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ── 4. Replay-attack check
  const [{ data: subDup }, { data: payDup }] = await Promise.all([
    admin.from("subscriptions").select("user_id").eq("payment_reference", cleanRef).limit(1),
    admin.from("admin_payments").select("id").eq("payment_reference", cleanRef).limit(1),
  ]);
  if ((subDup?.length ?? 0) > 0 || (payDup?.length ?? 0) > 0) {
    return json({ error: "This transaction ID has already been used", code: "duplicate_reference" }, 409);
  }

  // ── 5. Download receipt from storage as base64
  const { data: fileBlob, error: dlError } = await admin.storage
    .from("payment-receipts")
    .download(storagePath);
  if (dlError || !fileBlob) {
    return json({ error: "Could not read uploaded receipt" }, 400);
  }
  const buf = new Uint8Array(await fileBlob.arrayBuffer());
  const base64 = btoa(String.fromCharCode(...buf));
  const mime = fileBlob.type || "image/jpeg";

  // ── 6. AI verification (Gemini direct primary, Lovable fallback)
  const hasAnyKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("LOVABLE_API_KEY");
  if (!hasAnyKey) return json({ error: "AI gateway not configured" }, 500);

  const ai = await verifyWithAI(base64, mime, expectedPkr);
  if (!ai) {
    return json({ error: "AI verification temporarily unavailable. Please try again." }, 503);
  }

  // ── 7. Decide: auto-approve vs manual review
  const decision = decideActivation(ai, planId);

  const aiDetails = {
    extracted: { amount: ai.amount, receiver: ai.receiver, txnId: ai.txnId, date: ai.date },
    expected: { amount_pkr: expectedPkr, plan: planId },
    checks: decision.checks,
    // Why the decision went the way it did, in machine-readable form — an admin
    // reviewing a flagged receipt should not have to re-derive it from the
    // individual checks.
    failed_checks: decision.failed,
    confidence: ai.confidence,
    reasons: ai.reasons,
  };

  if (decision.action === "auto_approve") {
    return await autoApprove(admin, userId, planId, cleanRef, storagePath, ai.confidence, aiDetails);
  }

  // Manual review path
  await admin.from("subscriptions").update({
    upgrade_requested: true,
    pending_tier: planId,
    payment_reference: cleanRef,
    payment_proof_url: storagePath,
    ai_verification_status: "manual_review",
    ai_confidence_score: ai.confidence,
    ai_verification_details: aiDetails,
    last_upgrade_request: new Date().toISOString(),
  }).eq("user_id", userId);

  return json({
    success: true,
    autoApproved: false,
    confidence: ai.confidence,
    reasons: ai.reasons,
  });
}

Deno.serve(handle);

/**
 * The service-role client, typed loosely on purpose.
 *
 * `ReturnType<typeof createClient>` — the shape used here before this file was
 * ever typechecked, and still used in ~10 other edge functions — instantiates
 * the schema generics as `never`, so every `.from(…).update({…})` argument
 * becomes unassignable. There are no generated Database types in this project,
 * so `any` is the honest schema: it says "unchecked", instead of claiming a
 * contract that does not exist. Worth revisiting together with the other
 * occurrences once those functions gain tests and enter tsconfig too.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any>;

async function autoApprove(
  admin: AdminClient,
  userId: string,
  planId: PaidTier,
  referenceNo: string,
  storagePath: string,
  confidence: number,
  aiDetails: Record<string, unknown>,
): Promise<Response> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const limits = TIER_LIMITS[planId];

  // Approve profile
  await admin.from("profiles").update({ is_approved: true }).eq("user_id", userId);

  // Update subscription
  const { error: subErr } = await admin.from("subscriptions").update({
    tier: planId,
    is_approved: true,
    upgrade_requested: false,
    pending_tier: null,
    payment_reference: referenceNo,
    payment_proof_url: storagePath,
    ai_verification_status: "auto_approved",
    ai_confidence_score: confidence,
    ai_verification_details: aiDetails,
    activated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    billing_cycle_days: 30,
    transcription_limit: limits.transcription_limit,
    tts_character_limit: limits.tts_character_limit,
    ocr_pages_limit: limits.ocr_pages_limit,
    research_queries_limit: limits.research_queries_limit,
    islamic_queries_limit: limits.islamic_queries_limit,
    transcription_seconds_used: 0,
    tts_characters_used: 0,
    ocr_pages_used: 0,
    research_queries_used: 0,
    islamic_queries_used: 0,
    last_upgrade_request: now.toISOString(),
  }).eq("user_id", userId);
  if (subErr) {
    return json({ error: "Could not activate subscription", detail: subErr.message }, 500);
  }

  // Allocate tokens
  const monthlyTokens = TIER_TOKENS[planId];
  await admin.from("token_wallets").upsert({
    user_id: userId,
    monthly_balance: monthlyTokens,
    monthly_limit: monthlyTokens,
  }, { onConflict: "user_id" });

  // Log payment
  await admin.from("admin_payments").insert({
    user_id: userId,
    amount_pkr: TIER_PRICES_PKR[planId],
    payment_type: "subscription",
    payment_method: "manual_ai_verified",
    payment_reference: referenceNo,
    tier_at_payment: planId,
    notes: `AI auto-approved (confidence ${confidence}%)`,
    recorded_by: userId, // system-attributed; recorded_by NOT NULL
  });

  // Notify
  await admin.from("notifications").insert({
    user_id: userId,
    title: "Account activated",
    message: `Your ${planId.toUpperCase()} plan is now active. Welcome!`,
    is_read: false,
  });

  return json({ success: true, autoApproved: true, confidence });
}

async function verifyWithAI(
  base64: string,
  mime: string,
  expectedPkr: number,
): Promise<AIResult | null> {
  const systemPrompt = `You are a payment receipt verifier for an Islamic-research SaaS in Pakistan.
You receive an uploaded receipt image (bank transfer, JazzCash, EasyPaisa, or screenshot).
Extract details and rate authenticity. Be strict but fair.

Valid receivers: Al-Ulama (NBP IBAN PK04NBPA1997004243449556, Badami Bagh 1997),
Ulama Centre (JazzCash Till 00420745), Hafiz Khizar Hayat (JazzCash/EasyPaisa 0308 4164816).
Expected amount: ${expectedPkr} PKR (±2% or ±50 PKR tolerance).

Tampered signals: mismatched fonts, suspicious shadows, overlay artifacts, low compression on text only.
Output JSON only:
{"confidence": <0-100>, "amount": <number|null>, "receiver": <string|null>, "txnId": <string|null>, "date": <string|null>, "tampered": <bool>, "reasons": <string[]>}`;

  const userPrompt = `Verify this receipt. Extract amount in PKR (number only, no commas), receiver name OR account/till number, transaction ID, and date. Then give a confidence score 0-100 reflecting how likely this is a genuine payment of ${expectedPkr} PKR to one of the listed receivers.`;

  try {
    const res = await callChatCompletions({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[verify-receipt] AI gateway error", res.status, text);
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
    console.error("[verify-receipt] AI call threw", e);
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
