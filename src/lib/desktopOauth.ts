/**
 * Desktop (Electron) OAuth — the browser round trip the packaged app cannot do
 * for itself.
 *
 * The renderer is loaded from `file://`, so it has no origin a provider can
 * redirect back to, and Google refuses to authenticate inside an embedded
 * window regardless. The flow instead is:
 *
 *   1. Ask Supabase for the authorize URL but DON'T let it navigate this window
 *      (`skipBrowserRedirect`) — electron/main.ts's `will-navigate` guard would
 *      intercept the navigation and hand it to `shell.openExternal` anyway,
 *      which is how the first cut of this failed silently.
 *   2. Open that URL in the user's real browser over the IPC bridge.
 *   3. The provider redirects to `easyeditor://auth/callback`, the OS hands it
 *      back to this app, and main forwards the raw URL to the renderer.
 *   4. Complete the session here, where the Supabase client (and, for PKCE, the
 *      code verifier it stashed in step 1) actually lives.
 *
 * The web build does not use any of this — it keeps its ordinary redirect flow.
 */
import { supabase } from "@/integrations/supabase/client";

/** Must match APP_PROTOCOL in electron/main.ts and Supabase's Redirect URLs. */
export const DESKTOP_OAUTH_REDIRECT = "easyeditor://auth/callback";

/**
 * Start a desktop OAuth sign-in. Resolves once the consent page has been handed
 * to the system browser; the session itself arrives later via
 * {@link completeDesktopOauth}.
 */
export async function startDesktopOauth(
  provider: "google",
): Promise<{ error: Error | null }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: DESKTOP_OAUTH_REDIRECT,
      skipBrowserRedirect: true,
    },
  });

  if (error) return { error };
  if (!data?.url) return { error: new Error("No authorization URL returned.") };

  const opened = await window.electronAPI?.openExternal(data.url);
  if (!opened) {
    return { error: new Error("Could not open the browser for sign-in.") };
  }
  return { error: null };
}

/**
 * Finish a desktop OAuth sign-in from the `easyeditor://` callback URL.
 *
 * Handles both flows Supabase can be configured for: PKCE (a `code` query
 * param, the default) and implicit (tokens in the fragment). Returns an error
 * rather than throwing so the caller can surface it as a toast.
 */
export async function completeDesktopOauth(rawUrl: string): Promise<{ error: Error | null }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: new Error("Malformed sign-in callback.") };
  }

  // The provider reports failures on the callback too — surface those instead
  // of a generic "no credentials" message.
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) return { error: new Error(providerError) };

  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return { error: error ?? null };
  }

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const access_token = fragment.get("access_token");
  const refresh_token = fragment.get("refresh_token");
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    return { error: error ?? null };
  }

  return { error: new Error("Sign-in callback carried no credentials.") };
}
