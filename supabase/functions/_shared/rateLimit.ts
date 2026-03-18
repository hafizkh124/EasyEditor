/**
 * In-memory rate limiter for Supabase Edge Functions.
 * Limits requests per user within a sliding time window.
 * Note: This is per-instance; across cold starts, limits reset.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

/**
 * Check if a user has exceeded the rate limit.
 * @param userId - The user's unique ID
 * @param maxRequests - Max allowed requests per window
 * @param windowMs - Time window in milliseconds
 * @returns true if rate limit is exceeded, false otherwise
 */
export function isRateLimited(
  userId: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const key = userId;
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    // Start a new window
    store.set(key, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= maxRequests) {
    return true;
  }

  entry.count += 1;
  return false;
}

export function rateLimitResponse(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please wait a moment before trying again." }),
    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
