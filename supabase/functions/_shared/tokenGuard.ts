/**
 * tokenGuard.ts — Shared token deduction/credit utilities for all edge functions.
 *
 * Usage in any edge function:
 *   import { TOKEN_COSTS, calculateCost, checkAndDeductTokens, refundTokens } from "../_shared/tokenGuard.ts";
 *
 *   const cost = calculateCost("stt", Math.ceil(durationSeconds / 60));
 *   const result = await checkAndDeductTokens(supabase, userId, cost, "stt", "3.5 min transcription");
 *   if (!result.ok) return insufficientTokensResponse(result, corsHeaders);
 *
 *   // ... do AI work ...
 *   // On failure:
 *   await refundTokens(supabase, userId, cost, "stt", "AI call failed — refund");
 */

// ── Token cost table (canonical — mirrors client-side TOKEN_COSTS) ──────────
export const TOKEN_COSTS = {
  stt:            10,    // per minute of audio
  ocr:            15,    // per page scanned
  research:       30,    // per general research query
  islamic:        40,    // per Islamic research query
  tts_google:     50,    // per 1,000 characters (Google TTS)
  tts_elevenlabs: 500,   // per 1,000 characters (ElevenLabs TTS)
  refine:         5,     // per refinement action (formalize, humanize, etc.)
  translate:      20,    // per page/segment translated
  citation_search: 15,   // per Quran/Hadith citation search (plan + embed + rerank)
} as const;

export type ActionType = keyof typeof TOKEN_COSTS;

// ── Token allocation per tier ───────────────────────────────────────────────
export const TOKEN_ALLOCATIONS: Record<string, number> = {
  free:  0,
  basic: 5_000,
  pro:   25_000,
  ultra: 50_000,
};

// ── Cost calculator ─────────────────────────────────────────────────────────
/**
 * Calculate the token cost for an action.
 * @param action  — action type from TOKEN_COSTS
 * @param quantity — number of units (minutes for STT, pages for OCR, etc.)
 *                   Fractions are rounded up: 0.5 min = 1 min = 10 tokens.
 */
export function calculateCost(action: ActionType, quantity: number): number {
  return TOKEN_COSTS[action] * Math.max(1, Math.ceil(quantity));
}

// ── Admin check (cached per request) ────────────────────────────────────────
const adminCache = new Map<string, boolean>();

export async function isAdminUser(
  supabase: any,
  userId: string,
): Promise<boolean> {
  if (adminCache.has(userId)) return adminCache.get(userId)!;

  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  const isAdmin = !!data;
  adminCache.set(userId, isAdmin);
  return isAdmin;
}

// ── Deduction result type ───────────────────────────────────────────────────
export interface TokenResult {
  ok: boolean;
  monthly_balance?: number;
  topup_balance?: number;
  total?: number;
  error?: string;
  balance?: number;
  required?: number;
}

// ── Check & deduct tokens ───────────────────────────────────────────────────
/**
 * Atomically checks and deducts tokens for a user.
 * Admin users bypass the check entirely (unlimited access).
 *
 * @returns {ok: true, ...balances} on success, {ok: false, error, balance, required} on failure.
 */
export async function checkAndDeductTokens(
  supabase: any,
  userId: string,
  amount: number,
  actionType: ActionType | string,
  actionDetail?: string,
): Promise<TokenResult> {
  // Admin bypass
  if (await isAdminUser(supabase, userId)) {
    return { ok: true, monthly_balance: 999_999, topup_balance: 0, total: 999_999 };
  }

  const { data, error } = await supabase.rpc("deduct_tokens", {
    p_user_id: userId,
    p_amount: amount,
    p_action_type: actionType,
    p_action_detail: actionDetail ?? null,
  });

  if (error) {
    console.error(`[tokenGuard] deduct_tokens RPC error for ${userId}:`, error.message);
    return { ok: false, error: error.message };
  }

  // data is the JSONB return from the RPC
  const result = typeof data === "string" ? JSON.parse(data) : data;

  if (!result.success) {
    return {
      ok: false,
      error: result.error ?? "Insufficient tokens",
      balance: result.balance,
      required: result.required,
    };
  }

  return {
    ok: true,
    monthly_balance: result.monthly_balance,
    topup_balance: result.topup_balance,
    total: result.total,
  };
}

// ── Refund tokens (on AI call failure) ──────────────────────────────────────
/**
 * Credits back tokens when an action fails after deduction.
 * Credits to 'monthly' pool by default (since monthly is drained first).
 * Non-fatal: logs errors but doesn't throw.
 */
export async function refundTokens(
  supabase: any,
  userId: string,
  amount: number,
  actionType: ActionType | string,
  detail?: string,
): Promise<void> {
  // Admin bypass — nothing was deducted
  if (await isAdminUser(supabase, userId)) return;

  try {
    const { error } = await supabase.rpc("credit_tokens", {
      p_user_id: userId,
      p_amount: amount,
      p_source: "monthly",
      p_action_type: "refund",
      p_detail: detail ?? `Refund for failed ${actionType}`,
    });
    if (error) {
      console.error(`[tokenGuard] refund error for ${userId}:`, error.message);
    }
  } catch (e) {
    console.error(`[tokenGuard] refund exception for ${userId}:`, e);
  }
}

// ── Convenience: build insufficient-tokens HTTP response ────────────────────
export function insufficientTokensResponse(
  result: TokenResult,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: "Insufficient tokens",
      balance: result.balance ?? 0,
      required: result.required ?? 0,
    }),
    {
      status: 402,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
