import { useEffect, useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Globe, RefreshCw, BookOpen, Info, HelpCircle, Download, ExternalLink } from "lucide-react";
import { useLocalShamela } from "@/hooks/useLocalShamela";
import { useLanguage } from "@/contexts/LanguageContext";
import { ShamelaBridgeGuideModal } from "@/components/mcp/ShamelaBridgeGuideModal";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8000";
const DESKTOP_RELEASES_URL = "https://github.com/hafizkh124/EasyEditor/releases";

// Bounded auto-poll after the user downloads the bridge: check every 3s so
// the badge can flip to Active on its own once start-bridge.bat is running,
// without ever becoming a permanent interval (useLocalShamela's own mount
// probe deliberately stays one-shot — see its comment on the loop risk).
// Capped at 2 minutes; stops immediately on connect or unmount.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40;

/**
 * Web counterpart to `ShamelaConnectPanel` (UX-v1 P7 follow-up). The desktop
 * panel only ever checks `window.electronAPI.shamela` and errors out on web
 * ("native interface desktop only") without attempting the HTTP bridge that
 * `tools/shamela-bridge` already provides and that `BrowseTab` already
 * consumes silently via `useShamelaAvailability`. This panel is the missing
 * user-facing connect/test step for that same bridge, using `useLocalShamela`
 * (already built for exactly this, just never wired into Settings before).
 */
export function ShamelaBridgeConnectPanel() {
  const { t } = useLanguage();
  const { mcpUrl, setMcpUrl, connected, downloadedBooks, catalogBooks, notes, testing, testConnection } =
    useLocalShamela();
  const [urlDraft, setUrlDraft] = useState(mcpUrl || DEFAULT_BRIDGE_URL);
  const [guideOpen, setGuideOpen] = useState(false);
  const [zipBytes, setZipBytes] = useState<number | null>(null);
  const [polling, setPolling] = useState(false);
  const pollAttempts = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/downloads/shamela-bridge.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((meta: { bytes?: number } | null) => {
        if (!cancelled && meta?.bytes) setZipBytes(meta.bytes);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Armed only after the user clicks the download button — not on every
  // mount — and torn down the moment it either connects or hits the cap.
  useEffect(() => {
    if (!polling || connected) {
      setPolling(false);
      return;
    }
    const id = window.setInterval(() => {
      pollAttempts.current += 1;
      if (pollAttempts.current >= POLL_MAX_ATTEMPTS) {
        setPolling(false);
        return;
      }
      testConnection().catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [polling, connected, testConnection]);

  const handleTest = async () => {
    const url = urlDraft.trim() || DEFAULT_BRIDGE_URL;
    setMcpUrl(url);
    await testConnection(url);
  };

  const handleDownload = () => {
    pollAttempts.current = 0;
    setPolling(true);
  };

  const zipSizeLabel = zipBytes ? `${(zipBytes / (1024 * 1024)).toFixed(1)} MB` : null;

  return (
    <Card dir="rtl" className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            {t("shamela.bridge.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGuideOpen(true)}
              className="text-xs gap-1.5 h-8"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {t("shamela.guide")}
            </Button>
            <Badge variant={connected ? "default" : "outline"} className="text-xs">
              {testing ? t("shamela.status.connecting") : connected ? t("shamela.status.active") : t("shamela.status.offline")}
            </Badge>
          </div>
        </div>
        <CardDescription className="text-xs mt-1">{t("shamela.bridge.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!connected && (
          <div className="space-y-2">
            <Label className="text-xs">{t("shamela.bridge.get_bridge")}</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              {zipSizeLabel && (
                <Button asChild size="sm" className="flex-1 gap-1.5" onClick={handleDownload}>
                  <a href="/downloads/shamela-bridge.zip" download>
                    <Download className="h-3.5 w-3.5" />
                    {t("shamela.bridge.download_zip")}
                    {` (${zipSizeLabel})`}
                  </a>
                </Button>
              )}
              <Button asChild variant="outline" size="sm" className="flex-1 gap-1.5">
                <a href={DESKTOP_RELEASES_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("shamela.bridge.download_desktop")}
                </a>
              </Button>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
              {t("shamela.bridge.smartscreen_note")}
            </p>
            {polling && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" />
                {t("shamela.bridge.waiting_for_bridge")}
              </p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">{t("shamela.bridge.url_label")}</Label>
          <div className="flex gap-2">
            <Input
              className="ltr text-xs font-mono"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder={DEFAULT_BRIDGE_URL}
            />
            <Button size="sm" onClick={handleTest} disabled={testing} className="shrink-0 gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${testing ? "animate-spin" : ""}`} />
              {t("shamela.bridge.test")}
            </Button>
          </div>
        </div>

        {connected && (
          <div className="p-3 rounded-lg border border-border bg-muted/60 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">{t("shamela.bridge.catalog_books")}</span>
              <span className="text-success font-semibold">{catalogBooks?.toLocaleString() ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">{t("shamela.bridge.downloaded_books")}</span>
              <span className="text-success font-semibold">{downloadedBooks?.toLocaleString() ?? "—"}</span>
            </div>
          </div>
        )}

        {notes.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            {notes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        )}

        {connected ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            {t("shamela.bridge.browse_hint")}
          </p>
        ) : (
          <div className="p-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-primary" />
              {t("shamela.bridge.setup_guide")}
            </p>
            <p>1. {t("shamela.bridge.setup_step1")}</p>
            <p>2. {t("shamela.bridge.setup_step2")}</p>
            <p>3. {t("shamela.bridge.setup_step3")}</p>
          </div>
        )}
      </CardContent>

      <ShamelaBridgeGuideModal open={guideOpen} onOpenChange={setGuideOpen} />
    </Card>
  );
}
