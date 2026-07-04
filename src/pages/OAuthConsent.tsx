import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseOauth, type AuthorizationDetails } from "@/lib/supabaseOauth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

// Routed at /.lovable/oauth/consent — Supabase redirects the user here to
// approve or deny an OAuth 2.1 client (used by ChatGPT / Claude / Codex / Cursor
// when connecting the Easy Editor MCP server).
export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Preserve the FULL consent URL so auth returns the user here.
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      try {
        const { data, error } = await getSupabaseOauth().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) {
          setError(error.message);
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const oauth = getSupabaseOauth();
      const { data, error } = approve
        ? await oauth.approveAuthorization(authorizationId)
        : await oauth.denyAuthorization(authorizationId);
      if (error) {
        setBusy(false);
        setError(error.message);
        return;
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setBusy(false);
        setError("No redirect returned by the authorization server.");
        return;
      }
      window.location.href = target;
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardContent className="space-y-4 pt-6">
          {error ? (
            <>
              <h1 className="text-lg font-semibold text-foreground">
                Could not load this authorization request
              </h1>
              <p className="text-sm text-muted-foreground">{error}</p>
            </>
          ) : !details ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading authorization request…
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center gap-2 text-center">
                <img
                  src="/favicon.png"
                  alt="Easy Editor"
                  width={40}
                  height={40}
                  className="rounded-lg"
                />
                <h1 className="text-lg font-semibold text-foreground">
                  Connect {details.client?.name ?? "an app"} to your Easy Editor account
                </h1>
                <p className="text-sm text-muted-foreground">
                  This lets {details.client?.name ?? "the requesting app"} read your
                  Easy Editor sessions, research chats and token balance as you.
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => decide(false)}
                >
                  Deny
                </Button>
                <Button
                  className="flex-1"
                  disabled={busy}
                  onClick={() => decide(true)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
