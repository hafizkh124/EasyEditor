import { TOKEN_COSTS, type TokenActionType } from "@/contexts/SubscriptionContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Coins } from "lucide-react";

/**
 * Small inline badge showing estimated token cost for an action.
 * Used beside action buttons on feature pages.
 */
export default function TokenCostBadge({
  action,
  quantity = 1,
  className = "",
}: {
  action: TokenActionType;
  quantity?: number;
  className?: string;
}) {
  const { t } = useLanguage();
  const cost = TOKEN_COSTS[action] * Math.max(1, Math.ceil(quantity));

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 ${className}`}
      title={t("tokens.estimated_cost") || "Estimated token cost"}
    >
      <Coins className="h-3 w-3" />
      ~{cost.toLocaleString()} {t("tokens.tokens") || "tokens"}
    </span>
  );
}
