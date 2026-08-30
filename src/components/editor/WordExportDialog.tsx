import React, { useCallback, useEffect, useState } from "react";
import { FileType, File as FileIcon, FileText, Loader2, CheckCircle2, ExternalLink, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { logger } from "@/lib/logger";

const log = logger.child("WordExportDialog");

type Target = "docx" | "pdf" | "rtf" | "txt";

const TARGETS: Array<{ id: Target; icon: React.ElementType; labelKey: string; fallback: string }> = [
  { id: "docx", icon: FileType, labelKey: "docbridge.export.target_docx", fallback: "Word (.docx)" },
  { id: "pdf", icon: FileIcon, labelKey: "docbridge.export.target_pdf", fallback: "PDF" },
  { id: "rtf", icon: FileText, labelKey: "docbridge.export.target_rtf", fallback: "Rich Text (.rtf)" },
  { id: "txt", icon: FileText, labelKey: "docbridge.export.target_txt", fallback: "Plain text (.txt)" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current editor HTML (already suggestion-stripped by the caller). */
  html: string;
  title: string;
}

/**
 * SPEC-M8 P3 — the desktop "export through Microsoft Word" dialog. Unlike the
 * browser exporters in the toolbar's Export menu, this drives real Word: RTL
 * page setup, real footnotes, and Word's own PDF engine. Desktop-only; the
 * caller gates on `isDesktop()` + `window.electronAPI?.docBridge`.
 */
export const WordExportDialog: React.FC<Props> = ({ open, onOpenChange, html, title }) => {
  const { t } = useLanguage();
  const [target, setTarget] = useState<Target>("docx");
  const [rtl, setRtl] = useState(true);
  const [trackChanges, setTrackChanges] = useState(false);
  const [losses, setLosses] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [percent, setPercent] = useState(0);
  const [resultPath, setResultPath] = useState<string | null>(null);

  const bridge = typeof window !== "undefined" ? window.electronAPI?.docBridge : undefined;

  // Refresh the loss list whenever the target changes.
  useEffect(() => {
    if (!open || !bridge) return;
    let cancelled = false;
    bridge.planConversion("html", target).then((plan) => {
      if (cancelled) return;
      setLosses(plan.ok ? plan.losses : []);
    }).catch(() => { if (!cancelled) setLosses([]); });
    return () => { cancelled = true; };
  }, [open, target, bridge]);

  // Progress events from the main process.
  useEffect(() => {
    if (!open || !bridge?.onProgress) return;
    return bridge.onProgress((p) => {
      if (p.op !== "export") return;
      setPercent(p.percent);
      if (p.phase === "done") setPhase("done");
    });
  }, [open, bridge]);

  // Reset when reopened.
  useEffect(() => {
    if (open) { setPhase("idle"); setPercent(0); setResultPath(null); }
  }, [open]);

  const runExport = useCallback(async () => {
    if (!bridge) return;
    setPhase("running");
    setPercent(10);
    try {
      const res = await bridge.exportDocument(html, title, target, { rtlPageSetup: rtl, trackChanges });
      if (res.cancelled) {
        setPhase("idle");
        setPercent(0);
        return;
      }
      setResultPath(res.outputPath);
      setPhase("done");
      setPercent(100);
      toast.success(t("docbridge.export.done", "Exported through Word"));
    } catch (err) {
      log.error("export failed", { err });
      setPhase("idle");
      setPercent(0);
      toast.error(err instanceof Error ? err.message : t("docbridge.export.failed", "Export failed"));
    }
  }, [bridge, html, title, target, rtl, trackChanges, t]);

  const openResult = useCallback(() => {
    if (resultPath) void bridge?.openPath(resultPath).catch(() => {
      toast.error(t("docbridge.export.open_failed", "Could not open the file"));
    });
  }, [bridge, resultPath, t]);

  const busy = phase === "running";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("docbridge.export.title", "Export through Microsoft Word")}</DialogTitle>
          <DialogDescription>
            {t("docbridge.export.description", "Uses your installed Word for high-fidelity RTL layout, footnotes, and PDF.")}
          </DialogDescription>
        </DialogHeader>

        {phase === "done" && resultPath ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-sm text-muted-foreground break-all">{resultPath}</p>
            <Button onClick={openResult} className="gap-2">
              <ExternalLink className="h-4 w-4" />
              {t("docbridge.export.open_file", "Open file")}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <RadioGroup value={target} onValueChange={(v) => setTarget(v as Target)} className="grid gap-2">
              {TARGETS.map(({ id, icon: Icon, labelKey, fallback }) => (
                <Label
                  key={id}
                  htmlFor={`wx-${id}`}
                  className="flex items-center gap-3 rounded-md border border-border p-2.5 cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <RadioGroupItem value={id} id={`wx-${id}`} />
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{t(labelKey as Parameters<typeof t>[0], fallback)}</span>
                </Label>
              ))}
            </RadioGroup>

            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                <Checkbox checked={rtl} onCheckedChange={(v) => setRtl(Boolean(v))} />
                {t("docbridge.export.opt_rtl", "Right-to-left page setup")}
              </Label>
              <Label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                <Checkbox checked={trackChanges} onCheckedChange={(v) => setTrackChanges(Boolean(v))} />
                {t("docbridge.export.opt_track", "Turn on Track Changes")}
              </Label>
            </div>

            {losses.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("docbridge.export.losses_title", "This conversion may lose:")}
                </div>
                <ul className="list-disc ps-4 space-y-0.5 text-muted-foreground">
                  {losses.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            )}

            {busy && <Progress value={percent} className="h-1.5" />}
          </div>
        )}

        {phase !== "done" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={runExport} disabled={busy || !bridge} className="gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("docbridge.export.run", "Export")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
