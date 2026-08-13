export interface PaymentAccountRow {
  labelKey: string;
  value: string;
  mono?: boolean;
  small?: boolean;
  /**
   * Dialable form of `value`, digits only. Present makes the row a phone: the
   * pricing dialog turns it into a `tel:` link, and `whatsapp` adds a chat link.
   */
  tel?: string;
  whatsapp?: string;
}

export interface PaymentAccount {
  methodKey: string;
  title: string;
  rows: PaymentAccountRow[];
}

/**
 * The one place account details live.
 *
 * They were previously duplicated: PendingApproval rendered this list while
 * Pricing hardcoded the same four accounts in its dialog's JSX. Two copies of a
 * bank account number is not a formatting problem — change an account in one
 * place and the other screen keeps quietly showing the old one, and a user
 * sends money to it. Both screens now read from here and keep their own layout.
 */
export const PAYMENT_ACCOUNTS: PaymentAccount[] = [
  {
    methodKey: "pricing.payment_method_nbp",
    title: "Al-Ulama",
    rows: [
      { labelKey: "pricing.payment_iban", value: "PK04NBPA1997004243449556", mono: true, small: true },
      { labelKey: "pricing.payment_branch", value: "Badami Bagh 1997" },
    ],
  },
  {
    methodKey: "pricing.payment_method_jazzcash_business",
    title: "Ulama Centre",
    rows: [{ labelKey: "pricing.payment_till_id", value: "00420745", mono: true }],
  },
  {
    methodKey: "pricing.payment_method_jazzcash_personal",
    title: "Hafiz Khizar Hayat",
    rows: [
      {
        labelKey: "pricing.payment_number",
        value: "0308 4164816",
        mono: true,
        tel: "03084164816",
        whatsapp: "923084164816",
      },
    ],
  },
  {
    methodKey: "pricing.payment_method_easypaisa_personal",
    title: "Hafiz Khizar Hayat",
    // EasyPaisa has no WhatsApp channel — same number, dialable only.
    rows: [{ labelKey: "pricing.payment_number", value: "0308 4164816", mono: true, tel: "03084164816" }],
  },
];

export const WHATSAPP_CONTACT_NUMBER = "923290010282";
export const WHATSAPP_CONTACT_URL = `https://wa.me/${WHATSAPP_CONTACT_NUMBER}`;
