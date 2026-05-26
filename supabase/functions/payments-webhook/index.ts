// Paddle webhook handler — auto-provisions subscriptions and credits token top-ups.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyWebhook, EventName, type PaddleEnv } from '../_shared/paddle.ts';

const TIER_LIMITS: Record<string, Record<string, number>> = {
  basic: { transcription_limit: 1800, tts_character_limit: 0, ocr_pages_limit: 30, research_queries_limit: 20, islamic_queries_limit: 10 },
  pro:   { transcription_limit: 18000, tts_character_limit: 0, ocr_pages_limit: 300, research_queries_limit: 200, islamic_queries_limit: 100 },
  ultra: { transcription_limit: 36000, tts_character_limit: 500000, ocr_pages_limit: 2000, research_queries_limit: 500, islamic_queries_limit: 500 },
};
const TOKEN_ALLOCATIONS: Record<string, number> = { basic: 5000, pro: 25000, ultra: 50000 };
const TOPUP_AMOUNTS: Record<string, number> = {
  topup_small_once: 2500,
  topup_medium_once: 10000,
  topup_large_once: 25000,
};
// USD prices in cents → recorded as PKR-equivalent for income tracking (1 USD ≈ 280 PKR)
const USD_TO_PKR = 280;

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
  }
  return _supabase;
}

const BILLING_CYCLE_DAYS = 30;

async function handleSubscriptionCreated(data: any, env: PaddleEnv) {
  const { id, customerId, items, status, currentBillingPeriod, customData } = data;
  const userId = customData?.userId;
  if (!userId) {
    console.error('[webhook] subscription.created without customData.userId');
    return;
  }
  const item = items?.[0];
  const productExtId = item?.product?.importMeta?.externalId;
  const priceExtId = item?.price?.importMeta?.externalId;
  if (!productExtId || !priceExtId) {
    console.warn('[webhook] missing importMeta.externalId', { rawProduct: item?.product?.id, rawPrice: item?.price?.id });
    return;
  }
  // productExtId is one of: basic_plan, pro_plan, ultra_plan
  const tier = productExtId.replace(/_plan$/, '') as 'basic' | 'pro' | 'ultra';
  const limits = TIER_LIMITS[tier];
  if (!limits) {
    console.warn('[webhook] unknown tier from product:', productExtId);
    return;
  }
  const tokens = TOKEN_ALLOCATIONS[tier] ?? 0;
  const now = new Date();
  const expiresAt = currentBillingPeriod?.endsAt
    ? new Date(currentBillingPeriod.endsAt)
    : new Date(now.getTime() + BILLING_CYCLE_DAYS * 24 * 60 * 60 * 1000);

  const sb = getSupabase();

  // Approve the profile
  await sb.from('profiles')
    .update({ is_approved: true, rejection_status: null, rejection_reason: null, rejected_at: null, rejected_by: null })
    .eq('user_id', userId);

  // Upsert the subscription row. There is one row per user (existing schema constraint),
  // so we update by user_id and add the Paddle identifiers.
  await sb.from('subscriptions').update({
    tier,
    ...limits,
    activated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    paddle_subscription_id: id,
    paddle_customer_id: customerId,
    environment: env,
    payment_source: 'paddle',
    cancel_at_period_end: false,
    upgrade_requested: false,
    pending_tier: null,
    status: status,
    updated_at: now.toISOString(),
  }).eq('user_id', userId);

  // Seed token wallet
  await sb.from('token_wallets').upsert({
    user_id: userId,
    monthly_balance: tokens,
    monthly_limit: tokens,
    topup_balance: 0,
  }, { onConflict: 'user_id' });

  // Income record — convert USD cents to PKR
  const usdAmount = Number(item?.price?.unitPrice?.amount ?? 0) / 100;
  await sb.from('admin_payments').insert({
    user_id: userId,
    amount_pkr: Math.round(usdAmount * USD_TO_PKR),
    payment_type: 'subscription',
    payment_method: 'paddle',
    payment_reference: id,
    tier_at_payment: tier,
    notes: `Paddle ${env} — $${usdAmount.toFixed(2)} USD`,
    recorded_by: userId, // self-recorded (auto)
  });

  await sb.from('notifications').insert({
    user_id: userId,
    title: 'Subscription activated',
    message: `Your ${tier.toUpperCase()} plan is now active. Welcome!`,
  });
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv) {
  const { id, status, currentBillingPeriod, scheduledChange, items } = data;
  const sb = getSupabase();
  const update: Record<string, unknown> = {
    status,
    cancel_at_period_end: scheduledChange?.action === 'cancel',
    updated_at: new Date().toISOString(),
  };
  if (currentBillingPeriod?.endsAt) {
    update.expires_at = currentBillingPeriod.endsAt;
    update.last_renewed_at = new Date().toISOString();
  }
  // Handle plan changes
  const productExtId = items?.[0]?.product?.importMeta?.externalId;
  if (productExtId) {
    const tier = productExtId.replace(/_plan$/, '') as 'basic' | 'pro' | 'ultra';
    if (TIER_LIMITS[tier]) {
      Object.assign(update, { tier, ...TIER_LIMITS[tier] });
    }
  }
  await sb.from('subscriptions').update(update)
    .eq('paddle_subscription_id', id)
    .eq('environment', env);
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv) {
  await getSupabase().from('subscriptions')
    .update({ status: 'canceled', cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq('paddle_subscription_id', data.id)
    .eq('environment', env);
}

async function handleTransactionCompleted(data: any, env: PaddleEnv) {
  // Detect one-time top-up purchases (no subscriptionId, price ID matches topup_*)
  const { items, customData, subscriptionId, id: txId } = data;
  if (subscriptionId) return; // subscription renewals handled by subscription.updated
  const userId = customData?.userId;
  if (!userId) return;
  const item = items?.[0];
  const priceExtId = item?.price?.importMeta?.externalId;
  if (!priceExtId || !TOPUP_AMOUNTS[priceExtId]) return;
  const tokens = TOPUP_AMOUNTS[priceExtId];
  const sb = getSupabase();

  await sb.rpc('credit_tokens', {
    p_user_id: userId,
    p_amount: tokens,
    p_source: 'topup',
    p_action_type: 'topup_paddle',
    p_detail: `Paddle top-up (tx ${txId})`,
  });

  const usdAmount = Number(item?.price?.unitPrice?.amount ?? 0) / 100;
  await sb.from('admin_payments').insert({
    user_id: userId,
    amount_pkr: Math.round(usdAmount * USD_TO_PKR),
    payment_type: 'topup',
    payment_method: 'paddle',
    payment_reference: txId,
    notes: `Paddle ${env} — ${tokens} tokens — $${usdAmount.toFixed(2)} USD`,
    recorded_by: userId,
  });

  await sb.from('notifications').insert({
    user_id: userId,
    title: 'Tokens credited',
    message: `${tokens.toLocaleString()} tokens have been added to your account.`,
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = new URL(req.url);
  const env = (url.searchParams.get('env') || 'sandbox') as PaddleEnv;
  try {
    const event = await verifyWebhook(req, env);
    switch (event.eventType) {
      case EventName.SubscriptionCreated:
        await handleSubscriptionCreated(event.data, env); break;
      case EventName.SubscriptionUpdated:
        await handleSubscriptionUpdated(event.data, env); break;
      case EventName.SubscriptionCanceled:
        await handleSubscriptionCanceled(event.data, env); break;
      case EventName.TransactionCompleted:
        await handleTransactionCompleted(event.data, env); break;
      default:
        console.log('[webhook] unhandled:', event.eventType);
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[payments-webhook] error:', e);
    return new Response('Webhook error', { status: 400 });
  }
});
