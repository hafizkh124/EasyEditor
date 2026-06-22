
# AI-Verified Manual Payment + Subscription Expiry Gating

## فیصلے (User-confirmed)

- SafePay مکمل طور پر codebase سے ہٹایا جائے گا (edge functions، webhook، hook، dialog، secrets)
- AI confidence ≥ 90% → تمام tiers (Basic/Pro/Ultra) auto-approve
- Grace period (7 دن): مکمل feature access + warning banner
- Renewal کے لیے الگ `verify-renewal-receipt` edge function (renewal_count, last_renewed_at update کرے)

---

## 1. Database & Storage

### Migration: `ai_payment_workflow`

- نیا private bucket `payment-receipts` (storage tool سے بنایا جائے گا)
- `storage.objects` پر RLS:
  - users: صرف اپنی `{userId}/...` فولڈر پر insert/select
  - admins: تمام objects select
- `subscriptions` table میں نئے کالم:
  - `payment_proof_url TEXT`
  - `ai_verification_status TEXT DEFAULT 'none'` (none | auto_approved | manual_review | rejected)
  - `ai_confidence_score INTEGER`
  - `ai_verification_details JSONB`
- `admin_list_users` RPC update — یہ نئے کالم return کرے
- `prevent_subscription_self_escalation` trigger میں ان نئے کالموں کو بھی include کریں (تاکہ user خود set نہ کر سکے)

---

## 2. Edge Functions

### نیا: `verify-receipt` (نئے activation کے لیے)

Workflow:
1. JWT validate → userId نکالیں
2. Body: `{ planId, referenceNo, storagePath }` (Zod validation)
3. Replay-attack check: `subscriptions.payment_reference` اور `admin_payments.payment_reference` میں `referenceNo` نہ ہو
4. Storage سے image fetch → base64
5. Lovable AI Gateway (`google/gemini-2.5-flash`) کو vision call:
   - OCR کریں؛ amount, sender, receiver, transaction ID, date نکالیں
   - cross-check: amount tier price سے match (Basic 1000, Pro 4000, Ultra 7000)
   - receiver `PAYMENT_ACCOUNTS` میں سے کوئی ایک ہو (NBP / JazzCash / EasyPaisa)
   - tampering signals (font mismatch, pixelation) کا اندازہ
   - structured JSON output: `{ confidence: 0-100, amount, receiver, txnId, reasons: [] }`
6. اگر confidence ≥ 90% اور checks pass:
   - `profiles.is_approved = true`
   - `subscriptions`: tier, TIER_LIMITS سے quotas, `activated_at = now()`, `expires_at = now() + 30d`, `payment_reference`, `payment_proof_url`, `ai_verification_status='auto_approved'`, `ai_confidence_score`, `ai_verification_details`
   - `token_wallets.monthly_balance = TOKEN_ALLOCATIONS[tier]`
   - `admin_payments` میں log
   - `notifications` میں welcome
   - `{ success: true, autoApproved: true }`
7. ورنہ:
   - `upgrade_requested=true, pending_tier, payment_reference, payment_proof_url, ai_verification_status='manual_review'`
   - `{ success: true, autoApproved: false, reasons }`

### نیا: `verify-renewal-receipt` (lapsed/expiring users کے لیے)

ویسی ہی AI verification، لیکن DB writes:
- اسی tier پر `expires_at = max(now(), expires_at) + 30d`
- `last_renewed_at = now()`, `renewal_count = renewal_count + 1`
- token wallet کو `monthly_balance = monthly_limit` پر reset
- `admin_payments.payment_type = 'renewal'`

### حذف: SafePay edge functions

- `supabase/functions/safepay-checkout/` delete
- `supabase/functions/safepay-webhook/` delete
- Secrets delete: `SAFEPAY_API_KEY`, `SAFEPAY_SECRET_KEY`, `SAFEPAY_WEBHOOK_SECRET`, `SAFEPAY_ENV`
- `safepay_pending_checkouts` table drop migration

---

## 3. Frontend — Core Layout & Gating

### `SubscriptionContext.tsx` — نئے computed fields

```ts
isExpired: boolean         // now > expires_at
daysUntilLapse: number     // 7 - days since expires_at (grace)
isLapsed: boolean          // now > expires_at + 7d
```

Admins ہمیشہ false رہیں گے (exempt)۔

### `ProtectedRoute.tsx`

اگر `isLapsed === true` اور route ∉ {`/pricing`, `/checkout/success`, `/profile`, `/settings`}: redirect → `/pricing?expired=true`

### نیا: `SubscriptionBanner.tsx`

- `isExpired && !isLapsed` → amber warning: "آپ کی سبسکرپشن ختم ہو چکی ہے۔ {daysUntilLapse} دن میں access بند ہو جائے گا۔" + "ابھی renew کریں" button (→ `/pricing`)
- `isLapsed` → red: "آپ کی سبسکرپشن ختم ہو گئی ہے۔ Renew کریں۔"
- `AppLayout` کے top nav کے بالکل نیچے render

---

## 4. User Payment Pages

### `Pricing.tsx`

- `PlanCheckoutChoiceDialog` references ہٹائیں
- `useSafepayCheckout` import ہٹائیں
- "Get Plan" button براہِ راست `ManualPaymentDialog` کھولے
- اگر URL میں `?expired=true` → top پر "آپ کی سبسکرپشن ختم ہو گئی ہے" alert

### نیا یا توسیع شدہ: `ManualPaymentDialog.tsx` / `PaymentSubmitForm.tsx`

- بینک تفصیلات (PAYMENT_ACCOUNTS سے) دکھائیں
- Transaction ID input
- Receipt image uploader (jpg/png/webp, ≤ 5MB)
- Submit پر:
  1. `payment-receipts/{userId}/{uuid}.{ext}` پر upload
  2. `verify-receipt` یا `verify-renewal-receipt` (پہلے سے approved + expired → renewal endpoint)
  3. `autoApproved` → toast "آپ کا اکاؤنٹ فعال ہو گیا!" + `subscription.refetch()` + redirect dashboard
  4. ورنہ → toast "آپ کی receipt admin کو review کے لیے بھیج دی گئی" + redirect `/pending-approval`

### `PendingApproval.tsx`

- SafePay card section ہٹائیں
- وہی receipt upload flow include کریں
- Status messaging update: "AI خودکار تصدیق کے بعد فوری فعال؛ ورنہ admin manually review کرے گا"

### حذف

- `src/components/PlanCheckoutChoiceDialog.tsx`
- `src/hooks/useSafepayCheckout.ts`
- `src/pages/CheckoutSuccess.tsx` میں SafePay-specific branches simplify (manual flow کے لیے generic success)
- `PaymentTestModeBanner.tsx` (SafePay test mode کا تھا)

---

## 5. Admin Panel

### `admin/types.ts` — `UserRow` میں اضافے

```ts
payment_proof_url: string | null;
ai_verification_status: string | null;
ai_confidence_score: number | null;
ai_verification_details: Record<string, unknown> | null;
```

### `UpgradeRequests.tsx`

ہر request پر:
- AI badge: `auto_approved` (green) / `manual_review` (amber) / `none`
- Confidence score (e.g. "AI: 72%")
- اگر `ai_verification_details.reasons` ہو تو tooltip میں دکھائیں
- "Receipt دیکھیں" button → `supabase.storage.from('payment-receipts').createSignedUrl(payment_proof_url, 300)` → نئی tab میں کھولیں

---

## Technical Details

- **AI model**: `google/gemini-2.5-flash` Lovable AI Gateway کے ذریعے (vision + structured JSON output)۔ Schema چھوٹا رکھیں (Gemini state-limit)
- **Image handling**: edge function میں storage سے download → base64 → `image_url: data:image/...;base64,...`
- **Idempotency**: replay check + `payment_reference` پر unique constraint (نئی migration)
- **Security**: receipt download admin signed URL سے (5 min expiry)؛ verify-receipt service role سے DB writes کرے
- **Cron**: `check-subscription-expiry` already موجود — اسے بحال رکھیں، صرف notification messages update کریں (grace ending warning)
- **Token costs**: vision call ~3-5k tokens (~PKR چند روپے فی receipt)؛ ٹھیک ہے

---

## Verification

1. Migration run → bucket + columns بنیں
2. Edge function unit test: mocked Gemini response (high/low confidence دونوں)
3. Replay-attack: وہی `referenceNo` دوبارہ → reject
4. End-to-end:
   - نیا user → `/pricing` → Pro select → receipt upload → auto-activate
   - blurry receipt → manual review queue → admin panel میں receipt thumbnail + AI reasons
5. Expiry simulation (`expires_at` manually edit):
   - 3 دن پہلے → amber banner، access intact
   - 10 دن پہلے → red banner، `/pricing?expired=true` پر redirect
6. Renewal: lapsed user → receipt upload → `verify-renewal-receipt` → `expires_at` +30d، `renewal_count++`

---

## Out of Scope

- WhatsApp/SMS notifications (موجودہ email infra کافی ہے)
- SafePay واپس لانے کا feature flag (مکمل deletion)
- Multi-currency / international cards
