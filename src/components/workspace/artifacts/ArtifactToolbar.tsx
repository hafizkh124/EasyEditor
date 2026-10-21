import React, { useRef, useState } from "react";
import { Download, Maximize2, ClipboardCopy, FileInput, Check, X, Share2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { svgElementToBlob, svgElementToPng, downloadBlob } from "@/lib/export/svgExport";
import { copyRich } from "@/lib/export/copyRich";
import { loadEditorFont } from "@/lib/fonts";
import { logger } from "@/lib/logger";
import { ShareCard } from "./ShareCard";
import type { ArtifactState } from "../agentArtifactState";

const log = logger.child("ArtifactToolbar");

/**
 * Plan §5.4 — the artifact actions, type-guarded:
 *  1. Insert into editor  (when a workspace/editor is mounted)
 *  2. Export PNG / SVG    (sanad-tree, matn-diff — anything with a rendered <svg>)
 *  2b. Share card (PNG)   (table artifacts — M12 Phase F's ShareCard, not the
 *                          raw <svg> export above, since a table has none)
 *  3. Fullscreen          (handled by the parent via `onFullscreen`)
 *  4. Copy formatted
 */
export const ArtifactToolbar: React.FC<{
  artifact: ArtifactState;
  /** The rendered artifact DOM (for SVG export + rich copy). */
  bodyRef: React.RefObject<HTMLDivElement>;
  onFullscreen?: () => void;
  onDismiss?: () => void;
}> = ({ artifact, bodyRef, onFullscreen, onDismiss }) => {
  const { t } = useLanguage();
  const ws = useOptionalWorkspace();
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const shareCardRef = useRef<SVGSVGElement | null>(null);

  const svg = () => bodyRef.current?.querySelector("svg") as SVGSVGElement | null;
  // A table artifact renders an HTML <table>, not an <svg> — PNG/SVG export
  // (raw serialisation of bodyRef's own <svg>) only ever applied to the two
  // types that genuinely render one. It used to also claim "table" (M11
  // Phase 4, ADR-0048), which made the button silently no-op every time
  // (svg() returned null) — M12 Phase F replaces that with the dedicated
  // Share Card button below, the actual fix.
  const isVisual = artifact.type === "sanad-tree" || artifact.type === "matn-diff";
  const isTable = artifact.type === "table" && Boolean(artifact.table);

  const htmlForCopy = (): string => {
    if (artifact.html) return artifact.html;
    if (bodyRef.current) return bodyRef.current.innerHTML;
    return artifact.text ?? "";
  };

  const doInsert = () => {
    if (!ws) return;
    ws.insertIntoCanvas(htmlForCopy());
    setInserted(true);
    setTimeout(() => setInserted(false), 1500);
  };

  const doCopy = async () => {
    const ok = await copyRich(htmlForCopy(), bodyRef.current?.innerText ?? artifact.text ?? "");
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const exportAs = async (kind: "png" | "svg") => {
    const el = svg();
    if (!el) return;
    const name = `${artifact.title || "artifact"}.${kind}`.replace(/[/\\?%*:|"<>]/g, "-");
    const blob = kind === "svg" ? svgElementToBlob(el) : await svgElementToPng(el, 2);
    downloadBlob(blob, name);
  };

  // M12 Phase F — the off-screen <ShareCard> (mounted whenever isTable, see
  // below) is always ready by the time this fires; scale:1 because the card
  // is already a real 1200×1200 SVG, not something to further oversample.
  const doShareCard = async () => {
    const el = shareCardRef.current;
    if (!el || sharing) return;
    setSharing(true);
    try {
      try { await loadEditorFont("nastaliq"); } catch (err) { log.warn("Nastaliq font failed to load for the share card — falling back to the SVG's default serif", { err }); }
      try { await document.fonts?.ready; } catch { /* not fatal — best effort */ }
      const blob = await svgElementToPng(el, 1);
      const name = `${artifact.title || "share-card"}.png`.replace(/[/\\?%*:|"<>]/g, "-");
      downloadBlob(blob, name);
    } finally {
      setSharing(false);
    }
  };

  const btn = "inline-flex h-7 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  const insertLabel = t("artifact.insert", "Insert into editor");
  const fsLabel = t("artifact.fullscreen", "Fullscreen");
  const copyLabel = t("artifact.copy", "Copy formatted");
  const dismissLabel = t("artifact.dismiss", "Dismiss");
  const shareLabel = t("artifact.share_card", "Share card (PNG)");

  return (
    <div className="flex items-center gap-0.5">
      {ws && (
        <button className={btn} onClick={doInsert} title={insertLabel} aria-label={insertLabel}>
          {inserted ? <Check className="h-3.5 w-3.5 text-success" /> : <FileInput className="h-3.5 w-3.5" />}
        </button>
      )}
      {isVisual && (
        <>
          <button className={btn} onClick={() => void exportAs("png")} title={t("artifact.export_png", "Export PNG")} aria-label={t("artifact.export_png", "Export PNG")}>
            <Download className="h-3.5 w-3.5" /> {t("artifact.fmt_png", "PNG")}
          </button>
          <button className={btn} onClick={() => void exportAs("svg")} title={t("artifact.export_svg", "Export SVG")} aria-label={t("artifact.export_svg", "Export SVG")}>
            {t("artifact.fmt_svg", "SVG")}
          </button>
        </>
      )}
      {isTable && artifact.table && (
        <>
          <button className={btn} onClick={() => void doShareCard()} disabled={sharing} title={shareLabel} aria-label={shareLabel}>
            <Share2 className="h-3.5 w-3.5" /> {t("artifact.fmt_png", "PNG")}
          </button>
          {/* Off-screen — rendered so the ref is ready before the button is
              even clicked, kept out of layout/visual flow (not display:none,
              which some browsers refuse to rasterise text metrics for). */}
          <div style={{ position: "fixed", left: -99999, top: 0, pointerEvents: "none" }} aria-hidden="true">
            <ShareCard
              forwardRef={shareCardRef}
              title={artifact.title}
              table={artifact.table}
              footer={t("artifact.share_card_footer", "Prepared with EasyEditor — please verify with a qualified mufti")}
            />
          </div>
        </>
      )}
      {onFullscreen && (
        <button className={btn} onClick={onFullscreen} title={fsLabel} aria-label={fsLabel}>
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      )}
      <button className={btn} onClick={() => void doCopy()} title={copyLabel} aria-label={copyLabel}>
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
      </button>
      {onDismiss && (
        <button className={btn} onClick={onDismiss} title={dismissLabel} aria-label={dismissLabel}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
