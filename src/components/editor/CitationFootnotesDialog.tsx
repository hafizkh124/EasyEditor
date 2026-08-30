import React, { useCallback, useMemo, useState } from "react";
import { Loader2, CheckCircle2, ExternalLink, AlertTriangle, Quote } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { logger } from "@/lib/logger";
import type { TaskRunSource } from "@/core/workspace/types";

const log = logger.child("CitationFootnotesDialog");

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current editor HTML (already suggestion-stripped by the caller). */
  html: string;
  /** Current editor plain text — scanned for [N] markers. */
  text: string;
  /** Verified sources from the citations task run — sources[N-1] = "[N]". */
  sources: TaskRunSource[];
  title: string;
}

/**
 * SPEC-M8 P6 — send the citations task's output to a `.docx` with the
 * references as **real Word footnotes** at each `[N]` marker. The footnote
 * text is built in the main process from `sources` (verified), never from
 * whatever reference text sits in the document — the same integrity gate the
 * on-screen Sources list uses (`rebuildCitedRefinement`).
 */
export const CitationFootnotesDialog: React.FC<Props> = ({ open, onOpenChange, html, text, sources, title }) => {
  const { t } = useLanguage();
  const [rtl, setRtl] = useState(true);
  const [trackChanges, setTrackChanges] = useState(false);
  const [stripMarkers, setStripMarkers] = useState(true);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<{ outputPath: string; applied: number; notFound: string[]; unresolved: number[] } | null>(null);

  const bridge = typeof window !== "undefined" ? window.electronAPI?.docBridge : undefined;

  const markerCount = useMemo(() => {
    const ns = new Set<number>();
    for (const m of text.matchAll(/\[(\d+)\]/g)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= sources.length) ns.add(n);
    }
    return ns.size;
  }, [text, sources.length]);

  const run = useCallback(async () => {
    if (!bridge?.applyCitations) return;
    setPhase("running");
    setResult(null);
    try {
      const res = await bridge.applyCitations(
        html, text,
        sources.map((s) => ({ reference: s.reference, source_url: s.source_url })),
        title,
        { rtlPageSetup: rtl, trackChanges, stripMarkers },
      );
      if (res.cancelled) { setPhase("idle"); return; }
      setResult({ outputPath: res.outputPath, applied: res.applied, notFound: res.notFound, unresolved: res.unresolved });
      setPhase("done");
      toast.success(t("docbridge.cite.done", "Citations added as Word footnotes"));
    } catch (err) {
      log.error("applyCitations failed", { err });
      setPhase("idle");
      toast.error(err instanceof Error ? err.message : t("docbridge.cite.failed", "Could not add citations"));
    }
  }, [bridge, html, text, sources, title, rtl, trackChanges, stripMarkers, t]);

  const openResult = useCallback(() => {
    if (result?.outputPath) void bridge?.openPath(result.outputPath).catch(() => {
      toast.error(t("docbridge.export.open_failed", "Could not open the file"));
    });
  }, [bridge, result, t]);

  const busy = phase === "running";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Quote className="h-4 w-4 text-primary" />
            {t("docbridge.cite.title", "Add citations as Word footnotes")}
          </DialogTitle>
          <DialogDescription>
            {t("docbridge.cite.description", "Inserts each verified reference as a real Word footnote at its [N] marker.")}
          </DialogDescription>
        </DialogHeader>

        {phase === "done" && result ? (
          <div className="flex flex-col items-center gap-3 py-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-sm">
              {t("docbridge.cite.result", "{n} footnotes inserted").replace("{n}", String(result.applied))}
            </p>
            {(result.notFound.length > 0 || result.unresolved.length > 0) && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {result.notFound.length > 0 &&
                  t("docbridge.cite.not_found", "Markers not found: {m}").replace("{m}", result.notFound.join(" "))}
                {result.unresolved.length > 0 &&
                  ` ${t("docbridge.cite.unresolved", "No source for: {m}").replace("{m}", result.unresolved.map((n) => `[${n}]`).join(" "))}`}
              </p>
            )}
            <p className="text-xs text-muted-foreground break-all">{result.outputPath}</p>
            <Button onClick={openResult} className="gap-2">
              <ExternalLink className="h-4 w-4" />
              {t("docbridge.export.open_file", "Open file")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/60 p-2.5 text-xs text-muted-foreground">
              {t("docbridge.cite.summary", "{markers} markers · {sources} verified sources")
                .replace("{markers}", String(markerCount))
                .replace("{sources}", String(sources.length))}
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                <Checkbox checked={stripMarkers} onCheckedChange={(v) => setStripMarkers(Boolean(v))} />
                {t("docbridge.cite.opt_strip", "Replace [N] markers with the footnote number")}
              </Label>
              <Label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                <Checkbox checked={rtl} onCheckedChange={(v) => setRtl(Boolean(v))} />
                {t("docbridge.export.opt_rtl", "Right-to-left page setup")}
              </Label>
              <Label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                <Checkbox checked={trackChanges} onCheckedChange={(v) => setTrackChanges(Boolean(v))} />
                {t("docbridge.export.opt_track", "Turn on Track Changes")}
              </Label>
            </div>

            {markerCount === 0 && (
              <div className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("docbridge.cite.no_markers", "No [N] markers found in the document.")}
              </div>
            )}
          </div>
        )}

        {phase !== "done" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={run} disabled={busy || !bridge || markerCount === 0} className="gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("docbridge.cite.run", "Export to Word")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
