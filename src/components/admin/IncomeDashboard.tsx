import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DollarSign, Hash, TrendingUp, RefreshCw } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAdminPayments } from "@/hooks/useAdminPayments";

const PAYMENT_TYPE_KEYS: Record<string, string> = {
  subscription: "admin.payment_type_subscription",
  renewal: "admin.payment_type_renewal",
  upgrade: "admin.payment_type_upgrade",
  topup: "admin.payment_type_topup",
  other: "admin.payment_type_other",
};

const IncomeDashboard = () => {
  const { t } = useLanguage();
  const { fetchIncomeSummary, incomeSummary, incomeLoading } = useAdminPayments();
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Load once with the default (unbounded) range. Changing the dates must NOT
  // refetch on its own — these are free-text date inputs, so a dependency here
  // would fire a query per keystroke. `handleRefresh` below is the deliberate
  // trigger.
  useEffect(() => {
    fetchIncomeSummary(dateFrom || null, dateTo || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = () =>
    fetchIncomeSummary(dateFrom || null, dateTo || null);

  const formatPKR = (amount: number) =>
    `PKR ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const avgPayment =
    incomeSummary && incomeSummary.payment_count > 0
      ? incomeSummary.total_income / incomeSummary.payment_count
      : 0;

  // For monthly bar chart — find max for scaling
  const monthlyMax = incomeSummary?.by_month?.reduce(
    (max, m) => Math.max(max, Number(m.total)),
    0,
  ) ?? 0;

  return (
    <div className="space-y-4">
      {/* Date range + refresh */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("admin.date_from")}</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 w-[140px] text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("admin.date_to")}</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 w-[140px] text-xs"
          />
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={handleRefresh} disabled={incomeLoading}>
          <RefreshCw className={`h-3.5 w-3.5 me-1 ${incomeLoading ? "animate-spin" : ""}`} />
          {t("admin.corpus_refresh") || "Refresh"}
        </Button>
      </div>

      {incomeLoading ? (
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : !incomeSummary || incomeSummary.payment_count === 0 ? (
        <p className="text-muted-foreground text-center py-8">{t("admin.no_payments")}</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-green-100 dark:bg-green-950 p-2">
                  <DollarSign className="h-5 w-5 text-green-700" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("admin.total_income")}</p>
                  <p className="text-lg font-bold">{formatPKR(Number(incomeSummary.total_income))}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-blue-100 dark:bg-blue-950 p-2">
                  <Hash className="h-5 w-5 text-blue-700" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("admin.payment_count")}</p>
                  <p className="text-lg font-bold">{incomeSummary.payment_count}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-amber-100 dark:bg-amber-950 p-2">
                  <TrendingUp className="h-5 w-5 text-amber-700" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("admin.avg_payment")}</p>
                  <p className="text-lg font-bold">{formatPKR(avgPayment)}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* By type table */}
          {incomeSummary.by_type.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t("admin.income_by_type")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">{t("admin.payment_type")}</TableHead>
                      <TableHead className="text-end">{t("admin.payment_count")}</TableHead>
                      <TableHead className="text-end">{t("admin.total_income")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {incomeSummary.by_type.map((row) => (
                      <TableRow key={row.type}>
                        <TableCell className="text-start">
                          {PAYMENT_TYPE_KEYS[row.type]
                            ? t(PAYMENT_TYPE_KEYS[row.type] as import("@/lib/i18n").TranslationKey)
                            : row.type}
                        </TableCell>
                        <TableCell className="text-end">{row.cnt}</TableCell>
                        <TableCell className="text-end font-medium">{formatPKR(Number(row.total))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Monthly breakdown (CSS bar chart) */}
          {incomeSummary.by_month.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t("admin.income_by_month")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {incomeSummary.by_month.map((row) => {
                  const pct = monthlyMax > 0 ? (Number(row.total) / monthlyMax) * 100 : 0;
                  return (
                    <div key={row.month} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-[60px] flex-shrink-0">
                        {row.month}
                      </span>
                      <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                        <div
                          className="bg-primary h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium w-[90px] text-end flex-shrink-0">
                        {formatPKR(Number(row.total))}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default IncomeDashboard;
