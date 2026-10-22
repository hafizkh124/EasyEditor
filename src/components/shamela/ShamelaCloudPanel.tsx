import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CloudOff, Cloud, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { isDesktop } from "@/utils/environment";
import { logger } from "@/lib/logger";

const log = logger.child("ShamelaCloudPanel");

interface CloudStatus {
  connected: boolean;
  hasAccount: boolean;
  flowPending: boolean;
}

/**
 * ADR-0044 — the OAuth "connect account" deep-view for شامله لنک (cloud
 * Maktaba Shamela). The Hub card is the on/off toggle; this does the sign-in.
 * Desktop-only (the loopback + safeStorage OAuth flow is Electron).
 */
export function ShamelaCloudPanel() {
  const { t, direction } = useLanguage();
  const api = typeof window !== "undefined" ? window.electronAPI?.shamelaCloud : undefined;
  const [status, setStatus] = useState<CloudStatus>({ connected: false, hasAccount: false, flowPending: false });
  const [busy, setBusy] = useState<"connect" | "signOut" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    try { setStatus(await api.status()); } catch (err) { log.debug("shamelaCloud.status failed", { err }); }
  }, [api]);

  useEffect(() => { void refresh(); return () => { if (poll.current) clearInterval(poll.current); }; }, [refresh]);

  const connect = useCallback(async () => {
    if (!api) return;
    setBusy("connect");
    setError(null);
    // Poll while the browser flow is open so the panel flips to "connected".
    poll.current = setInterval(() => void refresh(), 1500);
    try {
      const r = await api.connect();
      setStatus(r);
      if (!r.ok && r.error) setError(r.error);
      else if (r.connected) toast.success(t("shamelaCloud.status.connected", "Connected"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (poll.current) { clearInterval(poll.current); poll.current = null; }
      setBusy(null);
      void refresh();
    }
  }, [api, refresh, t]);

  const signOut = useCallback(async () => {
    if (!api) return;
    setBusy("signOut");
    try { await api.signOut(); toast.success(t("shamelaCloud.signOut", "Sign out")); }
    catch (err) { log.warn("shamelaCloud.signOut failed", { err }); }
    finally { setBusy(null); void refresh(); }
  }, [api, refresh, t]);

  if (!isDesktop() || !api) return null;

  const state: keyof typeof STATE_LABEL =
    status.flowPending ? "pending"
    : status.connected ? "connected"
    : error ? "error"
    : status.hasAccount ? "savedNotConnected"
    : "disconnected";

  return (
    <Card dir={direction}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            {status.connected ? <Cloud className="h-4 w-4 text-primary" /> : <CloudOff className="h-4 w-4 text-muted-foreground" />}
            {t("shamelaCloud.panel.title", "شامله لنک (online)")}
          </CardTitle>
          <Badge variant={status.connected ? "default" : "outline"}>
            {t(`shamelaCloud.status.${state}`, STATE_LABEL[state])}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status.flowPending && (
          <p className="flex items-start gap-1.5 text-warning">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
            {t("shamelaCloud.waitingForBrowser", "A login page opened in your browser — approve access, then return here.")}
          </p>
        )}
        {error && !status.flowPending && <p className="text-xs text-destructive">{error}</p>}

        <p className="text-xs text-muted-foreground">{t("shamelaCloud.quotaNote", "")}</p>

        <div className="flex flex-wrap gap-2">
          {!status.connected && (
            <Button size="sm" onClick={() => void connect()} disabled={busy !== null || status.flowPending}>
              {busy === "connect" && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
              <ExternalLink className="me-1.5 h-3.5 w-3.5" />
              {status.hasAccount ? t("shamelaCloud.reconnect", "Reconnect") : t("shamelaCloud.connect", "Connect account")}
            </Button>
          )}
          {status.connected && (
            <Button size="sm" variant="outline" onClick={() => void connect()} disabled={busy !== null}>
              {t("shamelaCloud.reconnect", "Reconnect")}
            </Button>
          )}
          {status.hasAccount && (
            <Button size="sm" variant="ghost" onClick={() => void signOut()} disabled={busy !== null}>
              {busy === "signOut" && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
              {t("shamelaCloud.signOut", "Sign out")}
            </Button>
          )}
        </div>
        {!status.hasAccount && (
          <p className="text-xs text-muted-foreground">{t("shamelaCloud.opensBrowserOnce", "The login page opens once in your browser.")}</p>
        )}
      </CardContent>
    </Card>
  );
}

const STATE_LABEL = {
  disconnected: "Not connected",
  connected: "Connected",
  pending: "Waiting for browser approval…",
  savedNotConnected: "Account saved — not connected",
  error: "Connection error",
} as const;
