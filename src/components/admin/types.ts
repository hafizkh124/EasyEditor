export interface UserRow {
  user_id: string;
  email: string | null;
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
  token_monthly_balance: number;
  token_topup_balance: number;
  token_monthly_limit: number;
}

export type PaidTier = "basic" | "pro" | "ultra";
export type Tier = "free" | PaidTier;

export interface AdminPayment {
  id: string;
  user_id: string;
  amount_pkr: number;
  payment_type: "subscription" | "renewal" | "upgrade" | "topup" | "other";
  payment_method: string | null;
  payment_reference: string | null;
  tier_at_payment: string | null;
  notes: string | null;
  recorded_by: string;
  payment_date: string;
  created_at: string;
}

export interface UserFilters {
  search: string;
  status: "all" | "pending" | "approved" | "rejected";
  country: string;
  profession: string;
  dateFrom: string | null;
  dateTo: string | null;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface IncomeSummary {
  total_income: number;
  payment_count: number;
  by_type: { type: string; total: number; cnt: number }[];
  by_month: { month: string; total: number; cnt: number }[];
}
