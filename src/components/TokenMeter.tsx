import { Progress } from "@/components/ui/progress";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useLanguage } from "@/contexts/LanguageContext";
import { TOKEN_COSTS } from "@/contexts/SubscriptionContext";
import { Coins } from "lucide-react";

/**
 * TokenMeter — unified token progress bar replacing per-feature usage bars.
 *
 * Shows monthly usage as a progress bar with monthly/topup breakdown below.
 * Colors: green (normal) > amber (< 20% remaining) > red (0 remaining).
 */
export default function TokenMeter({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  const { total, topup, monthlyLimit, monthlyUsed, usagePct, isLow, isZero } = useTokenBalance();

  const barColor = isZero
    ? "bg-destructive"
    : isLow || usagePct >= 80
    ? "bg-amber-500"
    : "bg-primary";

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {t("tokens.balance", "Token Balance")}
          </span>
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {total.toLocaleString()} {t("tokens.tokens", "tokens")}
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative">
        <Progress
          value={Math.min(usagePct, 100)}
          className="h-2.5"
          // Override indicator color via CSS variable
          style={{ "--progress-color": undefined } as React.CSSProperties}
        />
        {/* Overlay colored bar */}
        <div
          className={`absolute inset-0 rounded-full overflow-hidden`}
          style={{ pointerEvents: "none" }}
        >
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(usagePct, 100)}%` }}
          />
        </div>
      </div>

      {/* Breakdown */}
      {!compact && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {t("tokens.monthly_used", "Used")}: {monthlyUsed.toLocaleString()} / {monthlyLimit.toLocaleString()}
          </span>
          {topup > 0 && (
            <span>
              {t("tokens.topup", "Top-up")}: {topup.toLocaleString()}
            </span>
          )}
        </div>
      )}

      {/* Token cost quick reference */}
      {!compact && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
          <span>STT: {TOKEN_COSTS.stt}/{t("tokens.per_min", "min")}</span>
          <span>OCR: {TOKEN_COSTS.ocr}/{t("tokens.per_page", "page")}</span>
          <span>Research: {TOKEN_COSTS.research}/{t("tokens.per_query", "query")}</span>
          <span>Islamic: {TOKEN_COSTS.islamic}/{t("tokens.per_query", "query")}</span>
          <span>TTS: {TOKEN_COSTS.tts_google}/{t("tokens.per_1k", "1K chars")}</span>
        </div>
      )}
    </div>
  );
}
