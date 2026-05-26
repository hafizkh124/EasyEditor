// Resolves human-readable Paddle price IDs (e.g. "pro_monthly") to Paddle internal IDs.
import { gatewayFetch, type PaddleEnv } from '../_shared/paddle.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function resolvePaddlePrice(priceId: string, environment: PaddleEnv): Promise<string> {
  const res = await gatewayFetch(environment, `/prices?external_id=${encodeURIComponent(priceId)}`);
  const data = await res.json();
  if (!data.data?.length) throw new Error(`Price not found: ${priceId}`);
  return data.data[0].id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { priceId, environment } = await req.json();
    if (!priceId) throw new Error('priceId required');
    const env: PaddleEnv = environment === 'live' ? 'live' : 'sandbox';
    const paddleId = await resolvePaddlePrice(priceId, env);
    return new Response(JSON.stringify({ paddleId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[get-paddle-price] error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
