import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, RefreshCw, HardDrive, HelpCircle,
  Search, BookOpen, Database, FileText, Copy
} from "lucide-react";
import { ShamelaGuideModal } from "@/components/mcp/ShamelaGuideModal";
import { useLanguage } from "@/contexts/LanguageContext";
import { translateStored, translateStoredFormat } from "@/lib/i18n";
import { logger } from "@/lib/logger";

const log = logger.child("ShamelaConnectPanel");

export interface ShamelaDiagnostics {
  jreFound: boolean;
  jreVersion: string | null;
  luceneJarsFound: boolean;
  luceneVersion: string | null;
  masterDbFound: boolean;
  storeIndexFound: boolean;
  bookCount: number;
  errors: string[];
}

export interface ShamelaStatus {
  installed: boolean;
  path: string | null;
  version?: string;
  masterDbPath?: string | null;
  reason?: string;
}

type ConnectState = "idle" | "connecting" | "connected" | "error";

interface ShamelaConnectPanelProps {
  /** Opens the book browser on the given tab. Omitted on surfaces that have no importer. */
  onBrowseBooks?: (masterDbPath: string, tab: "browse" | "search") => void;
}

export function ShamelaConnectPanel({ onBrowseBooks }: ShamelaConnectPanelProps = {}) {
  const { t } = useLanguage();
  const [state, setState] = useState<ConnectState>("idle");
  const [diagnostics, setDiagnostics] = useState<ShamelaDiagnostics | null>(null);
  const [status, setStatus] = useState<ShamelaStatus | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [stats, setStats] = useState<{ totalBooks: number; totalAuthors: number } | null>(null);

  const handleConnect = async () => {
    setState("connecting");
    setDiagnostics(null);
    setStats(null);

    try {
      if (typeof window === "undefined" || !window.electronAPI?.shamela) {
        toast.error(translateStored("toast.shamela.native_desktop_only"));
        setState("error");
        return;
      }

      // Step 1: Detect installation
      const det = await window.electronAPI.shamela.detect();
      if (!det.installed || !det.path) {
        toast.error(det.reason || translateStored("toast.shamela.not_found"));
        setState("error");
        return;
      }

      // Step 2: Run diagnostics
      const diag = await window.electronAPI.shamela.diagnose();
      setDiagnostics(diag);

      // Step 3: Fetch catalogue stats if master.db is available
      if (det.masterDbPath) {
        try {
          const catalogueStats = await window.electronAPI.shamela.catalogueStats(det.masterDbPath);
          setStats(catalogueStats);
        } catch {
          // catalogue is optional — silently continue
        }
      }

      setStatus(det);
      setState(diag.errors.length === 0 ? "connected" : "connected");

      if (diag.errors.length === 0) {
        toast.success(translateStored("toast.shamela.connected"));
      } else {
        toast.warning(translateStored("toast.shamela.connected_warning"));
      }
    } catch (err) {
      log.error("connection check failed", { err });
      toast.error(translateStoredFormat("toast.shamela.connection_failed", { error: err instanceof Error ? err.message : "Unknown error" }));
      setState("error");
    }
  };

  /** Builds a plain-text diagnostic report for pasting into a support request. */
  const buildDiagnosticsReport = (): string => {
    const yn = (ok: boolean) => (ok ? "ملا ✓" : "نہیں ملا ✗");
    const lines = [
      "مکتبہ شاملہ ۴ — تشخیصی رپورٹ",
      `تاریخ: ${new Date().toISOString()}`,
      `حالت: ${state}`,
      `مقام: ${status?.path ?? "—"}`,
      `ورژن: ${status?.version ?? "—"}`,
      `دستیاب کتب: ${stats?.totalBooks ?? "—"}`,
      "",
      `Java Runtime: ${yn(!!diagnostics?.jreFound)}${diagnostics?.jreVersion ? ` (${diagnostics.jreVersion})` : ""}`,
      `Lucene JARs: ${yn(!!diagnostics?.luceneJarsFound)}${diagnostics?.luceneVersion ? ` (${diagnostics.luceneVersion})` : ""}`,
      `master.db: ${yn(!!diagnostics?.masterDbFound)}`,
      `Store Index: ${yn(!!diagnostics?.storeIndexFound)}`,
    ];

    if (diagnostics?.errors.length) {
      lines.push("", `مسائل (${diagnostics.errors.length}):`);
      diagnostics.errors.forEach((e, i) => lines.push(`  ${i + 1}. ${e}`));
    }

    return lines.join("\n");
  };

  const handleCopyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnosticsReport());
      toast.success(translateStored("toast.diagnostics.copied"));
    } catch {
      toast.error(translateStored("toast.diagnostics.copy_failed"));
    }
  };

  const statusIcon = (ok: boolean) =>
    ok ? <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" /> :
         <XCircle className="h-4 w-4 text-red-500 shrink-0" />;

  return (
    <>
      <Card dir="rtl" className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              {t("shamela.connect.title")}
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
              <Badge
                variant={state === "connected" ? "default" : "outline"}
                className="text-xs"
              >
                {state === "connected" ? t("shamela.status.active") : state === "connecting" ? t("shamela.status.connecting") : t("shamela.status.offline")}
              </Badge>
            </div>
          </div>
          <CardDescription className="text-xs mt-1">
            {t("shamela.connect.description")}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Connect button */}
          <Button
            size="lg"
            className="w-full gap-2 h-12 text-base font-semibold"
            onClick={handleConnect}
            disabled={state === "connecting"}
          >
            {state === "connecting" ? (
              <RefreshCw className="h-5 w-5 animate-spin" />
            ) : (
              <Database className="h-5 w-5" />
            )}
            {state === "connecting" ? t("shamela.status.connecting") :
             state === "connected"  ? t("shamela.reconnect") :
             t("shamela.connect")}
          </Button>

          {/* Connection info */}
          {status && (
            <div className="p-3 rounded-lg border border-border bg-muted/60 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{t("shamela.location")}</span>
                <code className="font-mono text-xs text-muted-foreground ltr">{status.path}</code>
              </div>
              {status.version && (
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{t("shamela.version")}</span>
                  <span className="text-muted-foreground">{status.version}</span>
                </div>
              )}
              {stats && (
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{t("shamela.books_available")}</span>
                  <span className="text-emerald-600 font-semibold">
                    {stats.totalBooks.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Diagnostic checklist */}
          {diagnostics && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  {t("shamela.diagnostics")}
                </span>
                {/* FR-5.9: a report the user can paste into a support message.
                    Reading four icons off a screenshot loses the versions,
                    which are the part that actually identifies the problem. */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={handleCopyDiagnostics}
                >
                  <Copy className="h-3 w-3" />
                  {t("shamela.copy_report")}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-xs">
                  {statusIcon(diagnostics.jreFound)}
                  <span>{t("shamela.java_runtime")}</span>
                  {diagnostics.jreVersion && (
                    <code className="font-mono text-xs text-muted-foreground mr-auto">
                      {diagnostics.jreVersion}
                    </code>
                  )}
                </div>
                <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-xs">
                  {statusIcon(diagnostics.luceneJarsFound)}
                  <span>{t("shamela.lucene_jars")}</span>
                  {diagnostics.luceneVersion && (
                    <code className="font-mono text-xs text-muted-foreground mr-auto">
                      {diagnostics.luceneVersion}
                    </code>
                  )}
                </div>
                <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-xs">
                  {statusIcon(diagnostics.masterDbFound)}
                  <span>{t("shamela.master_database")}</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-xs">
                  {statusIcon(diagnostics.storeIndexFound)}
                  <span>{t("shamela.store_index")}</span>
                </div>
              </div>

              {diagnostics.errors.length > 0 && (
                <div className="p-2.5 rounded border border-red-500/30 bg-red-500/5 space-y-1">
                  <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                    {t("shamela.issues")} ({diagnostics.errors.length})
                  </span>
                  <ul className="text-xs text-red-600/80 dark:text-red-400/80 list-disc list-inside space-y-0.5">
                    {diagnostics.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Quick actions when connected */}
          {state === "connected" && status?.masterDbPath && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 text-xs"
                onClick={() => onBrowseBooks?.(status.masterDbPath!, "search")}
              >
                <Search className="h-3.5 w-3.5" />
                {t("shamela.search_books")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 text-xs"
                onClick={() => onBrowseBooks?.(status.masterDbPath!, "browse")}
              >
                <BookOpen className="h-3.5 w-3.5" />
                {t("shamela.book_browser")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ShamelaGuideModal open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}
