import { PAYMENT_ACCOUNTS } from "@/lib/paymentAccounts";
import type { Translator, TranslationKey } from "@/lib/i18n";
import { CopyValue, PhoneValue } from "./CopyValue";

/**
 * The account list inside the upgrade dialog.
 *
 * These four blocks used to be written out by hand here while
 * `PendingApproval` rendered the same accounts from `PAYMENT_ACCOUNTS` — so the
 * app held two copies of its own bank details. This renders from that list, and
 * keeps the dialog's compact two-column presentation rather than sharing markup
 * with the card layout PendingApproval uses.
 */
export const PaymentAccountsPanel = ({ t }: { t: Translator }) => (
  <div className="space-y-3 max-h-[45vh] overflow-y-auto pe-1">
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
      {t("pricing.payment_methods_heading")}
    </p>

    {PAYMENT_ACCOUNTS.map((account) => (
      <div key={account.methodKey} className="rounded-lg border bg-muted p-3 space-y-1.5">
        <p className="text-sm font-semibold text-foreground">
          {t(account.methodKey as TranslationKey)}
        </p>
        <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm items-center">
          <span className="text-muted-foreground">{t("pricing.payment_account_title")}:</span>
          <span className="font-medium" dir="ltr">{account.title}</span>

          {account.rows.map((row) => {
            const label = t(row.labelKey as TranslationKey);
            return (
              <div key={row.labelKey + row.value} className="contents">
                <span className="text-muted-foreground">{label}:</span>
                {row.tel ? (
                  <PhoneValue
                    display={row.value}
                    raw={row.tel}
                    wa={row.whatsapp}
                    copyLabel={t("pricing.copy")}
                    copiedLabel={t("pricing.copied")}
                    waLabel={t("pricing.manual_note_whatsapp_label")}
                  />
                ) : (
                  <CopyValue
                    value={row.value}
                    mono={row.mono}
                    small={row.small}
                    label={label}
                    copyLabel={t("pricing.copy")}
                    copiedLabel={t("pricing.copied")}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    ))}
  </div>
);
