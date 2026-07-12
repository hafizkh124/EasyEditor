# Sync all plan prices to 1,400 / 5,400 / 8,400 PKR

Currently the Pricing page (`src/lib/planTiers.ts`) shows the new prices — **Basic 1,400 / Pro 5,400 / Ultra 8,400 PKR** — but the admin panel dropdown and the payment-instruction messages still show the old **1,000 / 4,000 / 7,000 PKR** in every locale.

## Files to update

### 1. Admin panel dropdown labels (used in `UserTable.tsx` plan selectors)

- `src/locales/en.json`
  - `admin.basic_plan`: `"Basic (1,400 PKR)"`
  - `admin.pro_plan_label`: `"Pro (5,400 PKR)"`
  - `admin.ultra_plan_label`: `"Ultra (8,400 PKR)"`
- `src/locales/ur.json`
  - `admin.basic_plan`: `"بیسک (1,400 PKR)"`
  - `admin.pro_plan_label`: `"پرو (5,400 PKR)"`
  - `admin.ultra_plan_label`: `"الٹرا (8,400 PKR)"`
- `src/locales/ar.json`
  - `admin.basic_plan`: `"باقة Basic (1,400 PKR)"`
  - `admin.pro_plan_label`: `"باقة Pro (5,400 PKR)"`
  - `admin.ultra_plan_label`: `"باقة Ultra (8,400 PKR)"`

### 2. Payment-instruction amount strings (shown on Pricing / checkout screens)

Update in `en.json`, `ur.json`, `ar.json`:

- `pricing.payment_amount_basic` → 1,400 PKR / month
- `pricing.payment_amount_pro`   → 5,400 PKR / month
- `pricing.payment_amount_ultra` → 8,400 PKR / month

(Preserving each locale's existing phrasing, e.g. `"Amount: PKR 1,400 / month"`, `"رقم: PKR 1,400 / ماہ"`, `"المبلغ: 1,400 PKR / شهر"`.)

## Not changed

- `src/lib/planTiers.ts` already has 1,400 / 5,400 / 8,400 — no change needed.
- No code, database, or feature-limit changes; this is purely a display/label update.

## Verification

After the edits, open the admin panel plan dropdown and the Pricing page and confirm all three tiers show the new PKR amounts consistently in English, Urdu, and Arabic.
