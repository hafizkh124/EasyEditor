import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, RefreshCw, HardDrive,
  Database, Shield, FileText, Copy, Download, X,
} from "lucide-react";
import {
  tafsirConnect,
  tafsirDisconnect,
  tafsirDiagnose,
  tafsirInstallStart,
  tafsirInstallCancel,
  onTafsirInstallProgress,
  hasTafsirNative,
} from "@/lib/tafsir/tafsirService";
import type { TafsirMode, TafsirDiagnostics, TafsirConnectResult } from "@/lib/tafsir/tafsirService";
import { TafsirGuideModal } from "./TafsirGuideModal";
import { translateStored } from "@/lib/i18n";
import { logger } from "@/lib/logger";

const log = logger.child("TafsirConnectPanel");

type ConnectState = "idle" | "connecting" | "connected" | "error";

interface InstallState {
  running: boolean;
  percent: number;
  phase: "downloading" | "verifying";
}

interface TafsirConnectPanelProps {
  mode: TafsirMode;
  onConnectedChange: (connected: boolean) => void;
}

export function TafsirConnectPanel({ mode, onConnectedChange }: TafsirConnectPanelProps) {
  const [state, setState] = useState<ConnectState>("idle");
  const [diag, setDiag] = useState<TafsirDiagnostics | null>(null);
  const [connectInfo, setConnectInfo] = useState<TafsirConnectResult | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [install, setInstall] = useState<InstallState | null>(null);

  useEffect(() => {
    if (mode !== "local") return;
    let cancelled = false;
    tafsirDiagnose()
      .then((d) => { if (!cancelled) setDiag(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode]);

  const handleConnect = async () => {
    setState("connecting");
    setDiag(null);
    setConnectInfo(null);
    try {
      // Local mode requires the toolchain up-front; report it before touching MCP.
      if (mode === "local") {
        const det = await tafsirDiagnose();
        setDiag(det);
        if (!det.pythonFound || !det.uvFound) {
          toast.warning(translateStored("toast.tafsir.local_requirements"));
          setState("error");
          return;
        }
        if (!det.dbFound) {
          toast.error(translateStored("toast.tafsir.download_first"));
          setState("error");
          return;
        }
      }

      const result = await tafsirConnect(mode);
      setConnectInfo(result);

      if (mode === "remote") {
        const d = await tafsirDiagnose();
        setDiag(d);
        if (!d.remoteReachable) {
          toast.warning(translateStored("toast.tafsir.remote_unreachable"));
        }
      }

      setState("connected");
      onConnectedChange(true);
      toast.success(translateStored(mode === "remote" ? "toast.tafsir.remote_connected" : "toast.tafsir.local_connected"));
    } catch (err) {
      log.error("connection check failed", { err });
      toast.error(err instanceof Error ? err.message : translateStored("toast.common.connection_failed"));
      setState("error");
    }
  };

  const handleDisconnect = async () => {
    try {
      await tafsirDisconnect();
    } catch (err) {
      log.error("disconnect", { err });
    }
    setConnectInfo(null);
    setState("idle");
    onConnectedChange(false);
    toast.success(translateStored("toast.common.disconnected"));
  };

  const startDownload = async () => {
    setInstall({ running: true, percent: 0, phase: "downloading" });
    const off = onTafsirInstallProgress((p) =>
      setInstall({ running: true, percent: p.percent, phase: p.state }),
    );
    try {
      const status = await tafsirInstallStart();
      if (status.state === "idle") return; // cancelled during the run
      toast.success(translateStored("toast.tafsir.database_ready"));
      const d = await tafsirDiagnose();
      setDiag(d);
    } catch (err) {
      log.error("download", { err });
      toast.error(err instanceof Error ? err.message : translateStored("toast.tafsir.download_failed"));
    } finally {
      off();
      setInstall(null);
    }
  };

  const cancelDownload = async () => {
    await tafsirInstallCancel().catch(() => {});
    setInstall(null);
  };

  const buildDiagnosticsReport = (): string => {
    const yn = (ok?: boolean) => (ok ? "ملا ✓" : "نہیں ملا ✗");
    const lines = [
      "Tafsir MCP — تشخیصی رپورٹ",
      `تاریخ: ${new Date().toISOString()}`,
      `موڈ: ${mode}`,
      `حالت: ${state}`,
      `سرور: ${connectInfo?.server ?? "—"} ${connectInfo?.version ?? ""}`,
      `پہلے سے دستیاب آلات: ${connectInfo?.tools.length ?? "—"}`,
      "",
      `Python: ${yn(diag?.pythonFound)}${diag?.pythonVersion ? ` (${diag.pythonVersion})` : ""}`,
      `uv/uvx: ${yn(diag?.uvFound)}${diag?.uvVersion ? ` (${diag.uvVersion})` : ""}`,
      `مقامی DB: ${yn(diag?.dbFound)}`,
      `ریموٹ رسائی: ${yn(diag?.remoteReachable)}${diag?.remoteLatencyMs != null ? ` (${diag.remoteLatencyMs}ms)` : ""}`,
    ];
    (diag?.errors ?? []).forEach((e, i) => lines.push(`  ${i + 1}. ${e}`));
    return lines.join("\n");
  };

  const handleCopyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnosticsReport());
      toast.success(translateStored("toast.diagnostics.copied"));
    } catch {
      toast.error(translateStored("toast.common.copy_failed"));
    }
  };

  const statusIcon = (ok?: boolean) =>
    ok ? <CheckCircle className="h-4 w-4 text-success shrink-0" />
        : <XCircle className="h-4 w-4 text-destructive shrink-0" />;

  const native = hasTafsirNative();

  // Local mode: gate the connect button until the toolchain AND the DB exist.
  const toolchainOk = diag ? diag.pythonFound && diag.uvFound : false;
  const needsDb = mode === "local" && diag !== null && toolchainOk && !diag.dbFound;
  const connectBlocked = mode === "local" && (install !== null || needsDb || diag === null);

  return (
    <>
      <Card dir="rtl" className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              {mode === "local" ? <HardDrive className="h-5 w-5 text-primary" /> : <Database className="h-5 w-5 text-primary" />}
              Tafsir MCP — {mode === "local" ? "مقامی انضمام" : "آن لائن انضمام"}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="text-xs gap-1.5 h-8" onClick={() => setGuideOpen(true)}>
                <FileText className="h-3.5 w-3.5" /> گائیڈ
              </Button>
              <Badge variant={state === "connected" ? "default" : "outline"} className="text-xs">
                {state === "connected" ? "Active" : state === "connecting" ? "Connecting…" : "Offline"}
              </Badge>
            </div>
          </div>
          <CardDescription className="text-xs mt-1">
            قرآن کریم کے 28 تفاسیر اور علومِ قرآن تک براہِ راست رسائی — «آن لائن» انٹرنیٹ پر، «مقامی» آف لائن SQLite پر (مرکز تفسیر، CC BY 4.0)
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <Button
            size="lg" className="w-full gap-2 h-12 text-base font-semibold"
            onClick={handleConnect} disabled={state === "connecting" || connectBlocked}
          >
            {state === "connecting" ? <RefreshCw className="h-5 w-5 animate-spin" />
              : <Shield className="h-5 w-5" />}
            {state === "connecting" ? "منسلک ہو رہا ہے…" :
             needsDb ? "پہلے ڈیٹابیس ڈاؤن لوڈ کریں" :
             state === "connected" ? "دوبارہ جانچ کریں" : "Tafsir MCP سے منسلک ہوں"}
          </Button>

          {needsDb && (
            <div className="p-3 rounded-lg border border-border bg-muted/60 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <HardDrive className="h-4 w-4 text-primary" />
                <span className="font-medium text-foreground">مقامی ڈیٹابیس درکار ہے</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                تفسیر کا آف لائن ڈیٹابیس پہلی بار ~214 MB Hugging Face سے ڈاؤن لوڈ ہوتا ہے — اس کے بعد بغیر انٹرنیٹ کے چلتا ہے۔
              </p>
              {!install ? (
                <Button size="sm" className="w-full gap-1.5 text-xs" onClick={startDownload}>
                  <Download className="h-3.5 w-3.5" /> ڈیٹابیس ڈاؤن لوڈ کریں (214 MB)
                </Button>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span>{install.phase === "verifying" ? "SHA256 تصدیق…" : "ڈاؤن لوڈ ہو رہا ہے…"}</span>
                    <span className="tabular-nums">{install.percent}%</span>
                  </div>
                  <Progress value={install.percent} className="h-2" />
                  <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={cancelDownload}>
                    <X className="h-3.5 w-3.5" /> منسوخ کریں
                  </Button>
                </div>
              )}
            </div>
          )}

          {connectInfo && (
            <div className="p-3 rounded-lg border border-border bg-muted/60 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">سرور</span>
                <span className="text-muted-foreground">{connectInfo.server} {connectInfo.version}</span>
              </div>
              {connectInfo.endpoint && (
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">اینڈ پوائنٹ</span>
                  <span className="text-muted-foreground" dir="ltr">{new URL(connectInfo.endpoint).host}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">اوزار</span>
                <span className="text-muted-foreground">{connectInfo.tools.length}</span>
              </div>
            </div>
          )}

          {state === "connected" && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" onClick={handleDisconnect}>
                منقطع
              </Button>
            </div>
          )}

          {diag && (diag.errors.length > 0 || diag.remoteReachable !== undefined) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-primary" /> تشخیصی چیک لسٹ
                </span>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleCopyDiagnostics}>
                  <Copy className="h-3 w-3" /> رپورٹ کاپی کریں
                </Button>
              </div>
              <div className={native ? "grid grid-cols-2 gap-2" : "space-y-2"}>
                <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-xs">
                  {statusIcon(diag.remoteReachable)}
                  <span>آن لائن سرور</span>
                  {diag.remoteLatencyMs != null && <code className="mr-auto text-xs">{diag.remoteLatencyMs}ms</code>}
                </div>
                {/* Python/uv/local-DB only ever apply to the desktop "local" mode
                    (§Non-Goals: no local/stdio path on web) — tafsirDiagnose()
                    hardcodes them false on web, so showing these on web renders
                    three permanent red ✗ marks for requirements that do not
                    apply there. */}
                {native && (
                  <>
                    <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-xs">
                      {statusIcon(diag.pythonFound)}
                      <span>Python</span>
                      {diag.pythonVersion && <code className="mr-auto text-xs">{diag.pythonVersion}</code>}
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-xs">
                      {statusIcon(diag.uvFound)}
                      <span>uv/uvx</span>
                      {diag.uvVersion && <code className="mr-auto text-xs">{diag.uvVersion}</code>}
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded border border-border/60 text-xs">
                      {statusIcon(diag.dbFound)}
                      <span>مقامی DB</span>
                    </div>
                  </>
                )}
              </div>
              {diag.errors.length > 0 && (
                <div className="p-2.5 rounded border border-destructive/30 bg-destructive/5 space-y-1">
                  <span className="text-xs font-semibold text-destructive">
                    مسائل ({diag.errors.length})
                  </span>
                  <ul className="text-xs text-destructive/80 list-disc list-inside space-y-0.5">
                    {diag.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <TafsirGuideModal open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}
