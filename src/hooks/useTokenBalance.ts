import { useMemo } from "react";
import { useSubscription, TOKEN_COSTS, type TokenActionType } from "@/contexts/SubscriptionContext";

/**
 * Hook: unified token balance overview.
 *
 * Returns the user's current monthly + topup balances, usage percentage,
 * and low/zero flags for UI indicators.
 */
export function useTokenBalance() {
  const { tokenWallet } = useSubscription();

  return useMemo(() => {
    const monthly      = tokenWallet?.monthly_balance ?? 0;
    const topup        = tokenWallet?.topup_balance   ?? 0;
    const monthlyLimit = tokenWallet?.monthly_limit   ?? 0;
    const total        = monthly + topup;

    // Usage percentage: how much of monthly allocation has been consumed
    const monthlyUsed = monthlyLimit - monthly;
    const usagePct    = monthlyLimit > 0
      ? Math.min(100, Math.round((monthlyUsed / monthlyLimit) * 100))
      : 0;

    return {
      total,
      monthly,
      topup,
      monthlyLimit,
      monthlyUsed,
      usagePct,
      isLow:  total > 0 && total < 500,
      isZero: total <= 0,
    };
  }, [tokenWallet]);
}

/**
 * Hook: check if the user can afford a specific action.
 *
 * @param actionType - The token action type (stt, ocr, research, etc.)
 * @param quantity   - Number of units (minutes, pages, queries, etc.). Default 1.
 *
 * Returns `canAfford`, `cost`, and current `balance`.
 */
export function useCanAfford(actionType: TokenActionType, quantity = 1) {
  const { tokenWallet } = useSubscription();

  return useMemo(() => {
    const cost    = TOKEN_COSTS[actionType] * Math.max(1, Math.ceil(quantity));
    const balance = (tokenWallet?.monthly_balance ?? 0) + (tokenWallet?.topup_balance ?? 0);

    return {
      canAfford: balance >= cost,
      cost,
      balance,
    };
  }, [tokenWallet, actionType, quantity]);
}
