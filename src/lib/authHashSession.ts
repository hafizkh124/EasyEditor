import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lovable's managed Google OAuth broker returns the session as an *implicit*
 * hash fragment (`#access_token=…&refresh_token=…`). Our Supabase client is
 * configured with `flowType: 'pkce'` (required by the desktop OAuth path), and
 * auth-js hard-rejects an implicit callback in that mode ("Not a valid PKCE
 * flow url"), so the session was silently dropped and the user bounced back to
 * the home page still signed out.
 *
 * This picks the tokens out of the hash ourselves and hands them to
 * `setSession`, then clears the fragment. No-op for any other URL, so the PKCE
 * `?code=` path is untouched.
 */
export async function consumeImplicitAuthHash(
  supabase: Pick<SupabaseClient, "auth">,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash;
  if (!hash || !hash.includes("access_token")) return false;

  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) return false;

  // Clear the tokens from the address bar before any await, so they never
  // linger in history even if setSession fails.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  return !error;
}
