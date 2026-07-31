import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, RefreshCw, HardDrive, HelpCircle,
  Search, BookOpen, Database, FileText
} from "lucide-react";
import { ShamelaGuideModal } from "@/components/mcp/ShamelaGuideModal";

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
        toast.error("شاملہ کا نیٹیو انٹرفیس صرف ڈیسک ٹاپ ورژن میں دستیاب ہے۔");
        setState("error");
        return;
      }

      // Step 1: Detect installation
      const det = await window.electronAPI.shamela.detect();
      if (!det.installed || !det.path) {
        toast.error(det.reason || "مکتبہ شاملہ ۴ نہیں ملی۔");
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
        toast.success("مکتبہ شاملہ ۴ کامیابی سے منسلک ہو گئی ہے۔");
      } else {
        toast.warning("شاملہ منسلک ہے لیکن کچھ مسائل ہیں — تشخیصی فہرست دیکھیں۔");
      }
    } catch (err) {
      console.error("[ShamelaConnectPanel]", err);
      toast.error("کنکشن کے دوران خرابی: " + (err instanceof Error ? err.message : "unknown"));
      setState("error");
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
              مکتبہ شاملہ ۴ — مقامی انضمام
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGuideOpen(true)}
                className="text-xs gap-1.5 h-8"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                گائیڈ
              </Button>
              <Badge
                variant={state === "connected" ? "default" : "outline"}
                className="text-[10px]"
              >
                {state === "connected" ? "Active" : state === "connecting" ? "Connecting..." : "Offline"}
              </Badge>
            </div>
          </div>
          <CardDescription className="text-xs mt-1">
            اپنے کمپیوٹر پر نصب مکتبہ شاملہ ۴ سے ۴۰,۰۰۰+ کتب کو آف لائن براؤز، تلاش اور امپورٹ کریں
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
            {state === "connecting" ? "منسلک ہو رہا ہے..." :
             state === "connected"  ? "دوبارہ جانچ کریں" :
             "شاملہ سے منسلک ہوں"}
          </Button>

          {/* Connection info */}
          {status && (
            <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">مقام کا پتہ</span>
                <code className="font-mono text-[11px] text-muted-foreground ltr">{status.path}</code>
              </div>
              {status.version && (
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">ورژن</span>
                  <span className="text-muted-foreground">{status.version}</span>
                </div>
              )}
              {stats && (
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">دستیاب کتب</span>
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
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-primary" />
                تشخیصی چیک لسٹ
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-[11px]">
                  {statusIcon(diagnostics.jreFound)}
                  <span>Java Runtime</span>
                  {diagnostics.jreVersion && (
                    <code className="font-mono text-[10px] text-muted-foreground mr-auto">
                      {diagnostics.jreVersion}
                    </code>
                  )}
                </div>
                <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-[11px]">
                  {statusIcon(diagnostics.luceneJarsFound)}
                  <span>Lucene JARs</span>
                  {diagnostics.luceneVersion && (
                    <code className="font-mono text-[10px] text-muted-foreground mr-auto">
                      {diagnostics.luceneVersion}
                    </code>
                  )}
                </div>
                <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-[11px]">
                  {statusIcon(diagnostics.masterDbFound)}
                  <span>master.db (فہرست)</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-[11px]">
                  {statusIcon(diagnostics.storeIndexFound)}
                  <span>Store Index (متن)</span>
                </div>
              </div>

              {diagnostics.errors.length > 0 && (
                <div className="p-2.5 rounded border border-red-500/30 bg-red-500/5 space-y-1">
                  <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                    مسائل ({diagnostics.errors.length})
                  </span>
                  <ul className="text-[11px] text-red-600/80 dark:text-red-400/80 list-disc list-inside space-y-0.5">
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
                کتب تلاش کریں
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 text-xs"
                onClick={() => onBrowseBooks?.(status.masterDbPath!, "browse")}
              >
                <BookOpen className="h-3.5 w-3.5" />
                بک براؤزر
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ShamelaGuideModal open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}
