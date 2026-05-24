export interface PaymentAccount {
  methodKey: string;
  title: string;
  rows: { labelKey: string; value: string; mono?: boolean; small?: boolean }[];
}

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
    rows: [{ labelKey: "pricing.payment_number", value: "0308 4164816", mono: true }],
  },
  {
    methodKey: "pricing.payment_method_easypaisa_personal",
    title: "Hafiz Khizar Hayat",
    rows: [{ labelKey: "pricing.payment_number", value: "0308 4164816", mono: true }],
  },
];

export const WHATSAPP_CONTACT_NUMBER = "923290010282";
export const WHATSAPP_CONTACT_URL = `https://wa.me/${WHATSAPP_CONTACT_NUMBER}`;
