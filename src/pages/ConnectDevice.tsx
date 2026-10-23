import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSeo } from "@/hooks/useSeo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Loader2, MonitorSmartphone } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Desktop device-link sign-in — the web-side half.
 *
 * The desktop app opens this page (in the system browser) with `?code=` from
 * `supabase/functions/device-link`'s `create` action. Not a `ProtectedRoute`
 * — a visitor here very often isn't signed in on their system browser yet,
 * so (like `OAuthConsent.tsx`) this checks the session itself and bounces
 * through `/login?next=…` with the full `?code=` preserved. Once signed in,
 * Confirm just has to attach THIS session's real user id to that code — the
 * desktop app, polling `status`, picks up the hand-off the moment this
 * succeeds. See `src/lib/desktopDeviceLink.ts` for the desktop side and the
 * full flow write-up.
 */
type Phase = "loading" | "ready" | "confirming" | "done" | "error";

export default function ConnectDevice() {
  useSeo({ title: "Connect device — Al-Ulama Easy Editor", description: "Confirm signing in your Easy Editor desktop app.", path: "/connect-device", noindex: true });
  const { t, direction } = useLanguage();
  const [params] = useSearchParams();
  const code = params.get("code");
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorKey, setErrorKey] = useState<TranslationKey>("connect_device.error_generic");

  useEffect(() => {
    if (!code) {
      setPhase("error");
      setErrorKey("connect_device.error_missing_code");
      return;
    }
    // Not a ProtectedRoute (see App.tsx's comment): preserve the FULL
    // /connect-device?code=… URL across the sign-in round trip the same way
    // OAuthConsent.tsx does, since a user opening this link from the desktop
    // app very often isn't signed in on their system browser yet.
    let active = true;
    supabase.auth.getSession().then(({ data: sess }) => {
      if (!active) return;
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      setPhase("ready");
    });
    return () => {
      active = false;
    };
  }, [code]);

  async function confirm() {
    if (!code) return;
    setPhase("confirming");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        // The effect above should already have sent an unauthenticated
        // visitor to /login?next=…, but a session can also expire while this
        // tab sat open — surface the same recoverable state, not a dead end.
        setPhase("error");
        setErrorKey("connect_device.error_signed_out");
        return;
      }
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/device-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "confirm", code }),
      });
      if (resp.ok) {
        setPhase("done");
        return;
      }
      setPhase("error");
      setErrorKey(
        resp.status === 404 ? "connect_device.error_not_found"
        : resp.status === 409 ? "connect_device.error_already_used"
        : resp.status === 410 ? "connect_device.error_expired"
        : "connect_device.error_generic",
      );
    } catch {
      setPhase("error");
      setErrorKey("connect_device.error_generic");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4" dir={direction}>
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardContent className="space-y-4 pt-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {phase === "done" ? (
              <CheckCircle2 className="h-6 w-6 text-success" />
            ) : (
              <MonitorSmartphone className="h-6 w-6 text-primary" />
            )}
          </div>

          {phase === "loading" ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
          ) : phase === "error" ? (
            <>
              <h1 className="text-lg font-semibold text-foreground">{t("connect_device.error_title")}</h1>
              <p className="text-sm text-muted-foreground">{t(errorKey)}</p>
            </>
          ) : phase === "done" ? (
            <>
              <h1 className="text-lg font-semibold text-foreground">{t("connect_device.success_title")}</h1>
              <p className="text-sm text-muted-foreground">{t("connect_device.success_desc")}</p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-foreground">{t("connect_device.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("connect_device.description")}</p>
              {code && (
                <p className="font-mono text-lg tracking-widest text-foreground" dir="ltr">{code}</p>
              )}
              <Button className="w-full" disabled={phase === "confirming"} onClick={confirm}>
                {phase === "confirming" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("connect_device.confirm")}
              </Button>
            </>
          )}
          {phase !== "loading" && (
            <Button asChild variant="ghost" size="sm" className="w-full text-muted-foreground">
              <Link to="/dashboard">{t("nav.home", "Home")}</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
