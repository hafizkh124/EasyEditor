
# Plan: Paddle card checkout alongside manual PKR flow

## Goal
Add a self-serve "Pay by card" path that runs alongside the existing manual JazzCash/EasyPaisa/bank flow. Card payments auto-provision the tier (no admin step). Manual flow stays untouched.

## What you get
- 3 subscription products in Paddle: Basic $5/mo, Pro $19/mo, Ultra $29/mo
- 3 token top-up products: 2,500 / 10,000 / 25,000 tokens (one-time purchases)
- "Pay by card" button next to the existing "Request upgrade" button on `/pricing`
- Same on the top-up modal
- Webhook handler that, on successful payment: sets `is_approved=true`, sets tier + limits + 30-day window, seeds the token wallet, records the payment in `admin_payments` for income reporting, and sends a "Subscription activated" notification
- Auto-renew handled by Paddle: webhook extends `expires_at` each cycle, so your existing daily expiry cron continues to work untouched
- Cancellations: user keeps access until `current_period_end`; cron drops to free after that
- Test-mode banner in preview; legal pages (Terms, Refund Policy, Privacy Notice) for Paddle go-live

## One thing I need from you before coding
What's your **legal business name** (or your own name if you're not a registered business)? Paddle requires it on the Terms and Privacy pages. From the codebase it looks like "Al-Ulama" / Hafiz Khurram — please confirm the exact legal name.

## Steps

### 1. Catalog (Paddle test env)
Create products + prices with human-readable IDs that map cleanly to your tier system:
- `basic_plan` / `basic_monthly` — $5/mo
- `pro_plan` / `pro_monthly` — $19/mo
- `ultra_plan` / `ultra_monthly` — $29/mo
- `topup_small` / `topup_small_once` — $3 = 2,500 tokens
- `topup_medium` / `topup_medium_once` — $10 = 10,000 tokens
- `topup_large` / `topup_large_once` — $20 = 25,000 tokens
Ultra also flips from "Coming Soon" to active.

### 2. Database
Add to `subscriptions`: `paddle_subscription_id`, `paddle_customer_id`, `environment` (sandbox/live), `payment_source` ('manual' | 'paddle'). Doesn't break any existing rows.

### 3. Frontend
- `src/lib/paddle.ts` — Paddle.js init + price resolver
- `usePaddleCheckout` hook
- `PaymentTestModeBanner` (visible only in preview)
- `/pricing`: add "Pay by card" button next to existing "Request upgrade" on each plan card
- `UpsellModal`: add "Buy with card" option next to existing manual top-up
- `/checkout/success` page

### 4. Edge functions
- `get-paddle-price` — resolves human-readable IDs to Paddle internal IDs
- `payments-webhook` — handles `subscription.created/updated/canceled` and `transaction.completed`. For subscriptions: upserts the row, sets tier + limits via `TIER_LIMITS`, seeds token wallet via `TOKEN_ALLOCATIONS`, flips `is_approved`, inserts `admin_payments` row, sends notification. For top-up `transaction.completed` (one-time): credits tokens via `credit_tokens` RPC and inserts `admin_payments`.

### 5. Legal pages (required for Paddle go-live)
- `/terms` — includes Paddle MoR disclosure + GenAI/editing-software clauses (your product fits both)
- `/refund-policy` — 30-day money-back guarantee
- `/privacy` — data controller, categories, Paddle as recipient
Add footer links from Landing, Login, Signup.

### 6. Lifecycle integration
- Webhook updates `expires_at` on renewal → existing `check-subscription-expiry` cron stays as-is
- Cancellation webhook sets `cancel_at_period_end=true` but keeps access until period end
- Existing manual flow (admin approval / `renewSubscription` / `admin_payments` recording) is unchanged — admin panel keeps working for PKR payers

## Testing in preview (after I'm done)

The preview always uses Paddle's test environment, so nothing you do here charges real money. The orange "test mode" banner across the top will confirm that.

1. Open `/pricing` while logged in. Each plan card has two buttons: "Request upgrade" (existing manual flow) and "Pay by card" (new).
2. Click "Pay by card" on the Pro plan. Paddle's overlay opens.
3. Fill in any name, any email, and use test card **`4242 4242 4242 4242`**, CVC **`123`**, any future expiry. Country: any.
4. Submit. The overlay closes and you land on `/checkout/success`.
5. Within ~5 seconds, refresh `/dashboard` — your tier should now be Pro, token wallet at 25,000, `is_approved` true. A notification appears in the bell icon.
6. Check `/admin → Income` — the payment shows up as a Paddle transaction.
7. For top-ups: open the upsell modal, click "Buy with card" on the 10K pack, same test card → tokens credited immediately.
8. Other useful test cards: `4000 0000 0000 0002` (always declined), `4000 0000 0000 3220` (3D Secure challenge).

To test cancellation: cancel a subscription from the Paddle test dashboard or via API. Webhook flips `cancel_at_period_end=true`; you keep access until `current_period_end`.

## Going live (separate later step)
After you've tested in preview and want to accept real cards, you publish the app, complete Paddle's identity verification (your details + business info) from the Payments tab, and Paddle reviews the site (they check that Terms/Refund/Privacy pages are reachable and contain the required clauses — that's why step 5 exists). Until verification completes, the live checkout will show an error; preview test checkout keeps working the whole time.

## Out of scope
- Annual billing (can add later)
- Discount codes (can add later)
- Customer portal page inside the app (Paddle hosts one; we'll link to it from `/settings`)
- Migrating existing manual-flow PKR users to Paddle (they stay on manual until they choose to switch)
