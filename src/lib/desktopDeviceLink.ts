/**
 * Desktop Google sign-in — device-link flow (2026-09-13).
 *
 * Replaces the old `desktopOauth.ts` (direct `supabase.auth.signInWithOAuth`
 * call), which fails on this project: Google sign-in only works through
 * Lovable's own managed OAuth broker (`lovable.auth.signInWithOAuth`, used by
 * the web app's Login/Signup pages), and there is no supported way to give
 * this project its own Google Cloud credentials for a direct Supabase call.
 *
 * Flow (see `supabase/functions/device-link/index.ts` for the server side):
 *   1. {@link createDeviceLinkCode} — get a short-lived code, no session
 *      needed yet.
 *   2. Open `https://editor.alulama.org/connect-device?code=…` in the
 *      system browser (`window.electronAPI.openExternal`) — the user signs
 *      in there with the web app's *working* Google button and confirms.
 *   3. {@link pollDeviceLinkStatus} — call on an interval the caller owns
 *      (so it can be cancelled). Once it reports `confirmed`, immediately
 *      call {@link completeDeviceLinkSignIn} with the returned
 *      `email`/`tokenHash` to establish the real session — `AuthContext`'s
 *      existing `onAuthStateChange` picks it up like any other sign-in.
 */
import { supabase } from "@/integrations/supabase/client";

export const CONNECT_DEVICE_URL = "https://editor.alulama.org/connect-device";

export type DeviceLinkStatus = "pending" | "confirmed" | "claimed" | "expired" | "not_found";

async function callDeviceLink(body: Record<string, unknown>): Promise<{ data: unknown; error: Error | null }> {
  try {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/device-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      return { data: null, error: new Error((data as { error?: string } | null)?.error ?? `Request failed (${resp.status})`) };
    }
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** Start a device-link sign-in. Resolves with a code to show/open, or an error. */
export async function createDeviceLinkCode(): Promise<{ code: string; expiresAt: string } | { error: Error }> {
  const { data, error } = await callDeviceLink({ action: "create" });
  if (error) return { error };
  const body = data as { code: string; expiresAt: string };
  return { code: body.code, expiresAt: body.expiresAt };
}

/**
 * One status check — the caller owns the polling interval (and can stop it,
 * e.g. on a Cancel button) rather than this module running its own timer.
 */
export async function pollDeviceLinkStatus(
  code: string,
): Promise<{ status: DeviceLinkStatus; email?: string; tokenHash?: string } | { error: Error }> {
  const { data, error } = await callDeviceLink({ action: "status", code });
  if (error) return { error };
  return data as { status: DeviceLinkStatus; email?: string; tokenHash?: string };
}

/**
 * Redeem the server-minted token to establish the real Supabase session.
 * `email` isn't passed to `verifyOtp` — auth-js's token_hash variant rejects
 * the call outright ("Only the token_hash and type should be provided") if
 * `email` is present alongside it; the two are mutually exclusive verify
 * modes, not a pair. Kept as a parameter here only because callers already
 * have it from {@link pollDeviceLinkStatus} and may want it for a message.
 */
export async function completeDeviceLinkSignIn(_email: string, tokenHash: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  return { error: error ?? null };
}
