export interface UserRow {
  user_id: string;
  display_name: string | null;
  is_approved: boolean;
  created_at: string;
  tier: string;
  upgrade_requested: boolean;
  pending_tier: string | null;
  payment_reference: string | null;
  last_upgrade_request: string | null;
  rejection_status: string | null;
  rejection_reason: string | null;
  rejected_at: string | null;
  activated_at: string | null;
  expires_at: string | null;
  last_renewed_at: string | null;
  renewal_count: number;
  billing_cycle_days: number;
  referral_code: string | null;
  referred_by: string | null;
  referral_credits: number;
  whatsapp_number: string | null;
  country: string | null;
  profession: string | null;
}

export type PaidTier = "basic" | "pro" | "ultra";
export type Tier = "free" | PaidTier;
