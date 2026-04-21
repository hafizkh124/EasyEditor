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
}

export type PaidTier = "basic" | "pro" | "ultra";
export type Tier = "free" | PaidTier;
