/**
 * Credits granted to a referrer when one of their referees is approved by
 * the admin (i.e., becomes a paying subscriber). One-time per referee.
 *
 * Credits are accumulated in profiles.referral_credits. Redemption (e.g.,
 * trading credits for subscription discounts) is a future phase.
 */
export const REFERRAL_CREDIT_AMOUNT = 100;

/** URL search-param key for incoming referral signups. */
export const REFERRAL_PARAM = "ref";

export function buildReferralLink(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/signup?${REFERRAL_PARAM}=${encodeURIComponent(code)}`;
}

const PENDING_REFERRAL_STORAGE_KEY = "pending_referral_code";

export function stashPendingReferralCode(code: string): void {
  try {
    localStorage.setItem(PENDING_REFERRAL_STORAGE_KEY, code);
  } catch {
    /* storage may be unavailable in privacy mode */
  }
}

export function consumePendingReferralCode(): string | null {
  try {
    const code = localStorage.getItem(PENDING_REFERRAL_STORAGE_KEY);
    if (code) localStorage.removeItem(PENDING_REFERRAL_STORAGE_KEY);
    return code;
  } catch {
    return null;
  }
}

/**
 * Look up the referral code on profiles and write referred_by onto the
 * new user's profile. Idempotent — won't overwrite an existing referred_by.
 */
 
export async function applyPendingReferral(
  newUserId: string,
  code: string,
  supabase: any,
): Promise<void> {
  if (!code || !newUserId) return;
  const { data: referrer } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("referral_code", code)
    .single();
  if (!referrer?.user_id || referrer.user_id === newUserId) return;
  await supabase
    .from("profiles")
    .update({ referred_by: referrer.user_id })
    .eq("user_id", newUserId)
    .is("referred_by", null);
}

