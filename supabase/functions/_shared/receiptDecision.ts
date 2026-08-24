// The auto-approval decision for AI-verified payment receipts.
//
// This is the single most consequential branch in the codebase: on the true
// side it writes a paid tier, an expiry date, and a token allocation without a
// human ever seeing the receipt. It previously lived, duplicated verbatim, in
// both verify-receipt/index.ts and verify-renewal-receipt/index.ts, inside an
// inline `Deno.serve(async (req) => …)` handler — so nothing could test it and
// the two copies could drift apart silently.
//
// Everything here is pure: no I/O, no Deno APIs, no Supabase client. That is
// deliberate — it is what makes the decision testable from the Vitest suite
// while the modules still run unchanged under Deno.

export type PaidTier = "basic" | "pro" | "ultra";

export const TIER_PRICES_PKR: Record<PaidTier, number> = {
  basic: 1_400,
  pro: 5_400,
  ultra: 8_400,
};

/** Receiver accounts that should appear on a valid receipt. */
export const VALID_RECEIVERS = [
  "Al-Ulama",
  "Ulama Centre",
  "Hafiz Khizar Hayat",
  "PK04NBPA1997004243449556",
  "00420745",
  "03084164816",
  "0308 4164816",
  "0308-4164816",
];

export const CONFIDENCE_THRESHOLD = 90;

/**
 * Minimum length for an AI-extracted receiver before it may be matched as a
 * *substring of* a known account.
 *
 * Why this exists: the original comparison was bidirectional and unguarded —
 *
 *     VALID_RECEIVERS.some((r) =>
 *       receiver.toLowerCase().includes(r.toLowerCase()) ||
 *       r.toLowerCase().includes(receiver.toLowerCase()))
 *
 * The second direction accepts any extracted receiver that happens to be a
 * substring of a real account. `""` is a substring of every string, and `"0"`
 * is a substring of `"00420745"`. So a receipt whose receiver field the model
 * read as empty or as a single digit — a blurred scan, a cropped image, a
 * receipt genuinely paid to someone else — satisfied `receiverMatches`, and if
 * the amount happened to be right and confidence was high, it auto-approved.
 *
 * The shortest real receiver is "Al-Ulama" (8 characters), so requiring 6 loses
 * no legitimate match. Anything shorter now falls through to manual review,
 * which is the correct destination for a receipt we could not actually read.
 */
export const MIN_RECEIVER_SUBSTRING_LENGTH = 6;

/** Absolute PKR tolerance floor; percentage tolerance takes over above it. */
export const AMOUNT_TOLERANCE_FLOOR_PKR = 50;
export const AMOUNT_TOLERANCE_RATIO = 0.02;

export interface AIResult {
  confidence: number;
  amount: number | null;
  receiver: string | null;
  txnId?: string | null;
  date?: string | null;
  tampered: boolean;
  reasons?: string[];
}

export interface DecisionChecks {
  amount_matches: boolean;
  receiver_matches: boolean;
  confidence_meets_threshold: boolean;
  tampered: boolean;
}

export interface Decision {
  action: "auto_approve" | "manual_review";
  checks: DecisionChecks;
  expectedPkr: number;
  /** Machine-readable reasons the decision was NOT auto-approval. Empty when it was. */
  failed: string[];
}

/**
 * Does the extracted amount match what this tier costs?
 *
 * Tolerance is the greater of 50 PKR and 2% — bank receipts routinely differ by
 * a small transfer fee, and 2% of 1,400 is only 28.
 */
export function amountMatches(amount: number | null | undefined, expectedPkr: number): boolean {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return false;
  const tolerance = Math.max(AMOUNT_TOLERANCE_FLOOR_PKR, expectedPkr * AMOUNT_TOLERANCE_RATIO);
  return Math.abs(amount - expectedPkr) <= tolerance;
}

/**
 * Does the extracted receiver correspond to one of our accounts?
 *
 * Still bidirectional — a receipt line like "Transfer to Hafiz Khizar Hayat
 * (00420745)" contains a known account, and a model that returns just the
 * account number is contained by one. The second direction is length-guarded;
 * see MIN_RECEIVER_SUBSTRING_LENGTH.
 */
export function receiverMatches(receiver: string | null | undefined): boolean {
  if (typeof receiver !== "string") return false;
  const candidate = receiver.trim().toLowerCase();
  if (candidate.length === 0) return false;

  return VALID_RECEIVERS.some((r) => {
    const known = r.toLowerCase();
    // Direction 1: the receipt text contains a full known account. Always safe —
    // the known value carries the specificity.
    if (candidate.includes(known)) return true;
    // Direction 2: the model returned a fragment of a known account. Only
    // trustworthy when the fragment is long enough to be distinctive.
    if (candidate.length >= MIN_RECEIVER_SUBSTRING_LENGTH && known.includes(candidate)) return true;
    return false;
  });
}

/**
 * The whole auto-approval decision, in one testable place.
 *
 * Fails closed: any unexpected shape (non-numeric confidence, missing fields)
 * routes to manual review rather than throwing or approving.
 */
export function decideActivation(ai: AIResult, tier: PaidTier): Decision {
  const expectedPkr = TIER_PRICES_PKR[tier];

  const checks: DecisionChecks = {
    amount_matches: expectedPkr !== undefined && amountMatches(ai?.amount, expectedPkr),
    receiver_matches: receiverMatches(ai?.receiver),
    confidence_meets_threshold:
      typeof ai?.confidence === "number" &&
      Number.isFinite(ai.confidence) &&
      ai.confidence >= CONFIDENCE_THRESHOLD,
    tampered: ai?.tampered === true,
  };

  const failed: string[] = [];
  if (expectedPkr === undefined) failed.push("unknown_tier");
  if (!checks.confidence_meets_threshold) failed.push("low_confidence");
  if (!checks.amount_matches) failed.push("amount_mismatch");
  if (!checks.receiver_matches) failed.push("receiver_mismatch");
  if (checks.tampered) failed.push("tampered");

  return {
    action: failed.length === 0 ? "auto_approve" : "manual_review",
    checks,
    expectedPkr,
    failed,
  };
}
