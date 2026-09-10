import React, { useState } from "react";
import { Download, Maximize2, ClipboardCopy, FileInput, Check, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { svgElementToBlob, svgElementToPng, downloadBlob } from "@/lib/export/svgExport";
import { copyRich } from "@/lib/export/copyRich";
import type { ArtifactState } from "../agentArtifactState";

/**
 * Plan §5.4 — the four artifact actions, type-guarded:
 *  1. Insert into editor  (when a workspace/editor is mounted)
 *  2. Export PNG / SVG    (sanad-tree, matn-diff — anything with a rendered <svg>)
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

  const svg = () => bodyRef.current?.querySelector("svg") as SVGSVGElement | null;
  const isVisual = artifact.type === "sanad-tree" || artifact.type === "matn-diff";

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

  const btn = "inline-flex h-7 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <div className="flex items-center gap-0.5">
      {ws && (
        <button className={btn} onClick={doInsert} title={t("artifact.insert", "Insert into editor")}>
          {inserted ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <FileInput className="h-3.5 w-3.5" />}
        </button>
      )}
      {isVisual && (
        <>
          <button className={btn} onClick={() => void exportAs("png")} title={t("artifact.export_png", "Export PNG")}>
            <Download className="h-3.5 w-3.5" /> {t("artifact.fmt_png", "PNG")}
          </button>
          <button className={btn} onClick={() => void exportAs("svg")} title={t("artifact.export_svg", "Export SVG")}>
            {t("artifact.fmt_svg", "SVG")}
          </button>
        </>
      )}
      {onFullscreen && (
        <button className={btn} onClick={onFullscreen} title={t("artifact.fullscreen", "Fullscreen")}>
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      )}
      <button className={btn} onClick={() => void doCopy()} title={t("artifact.copy", "Copy formatted")}>
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
      </button>
      {onDismiss && (
        <button className={btn} onClick={onDismiss} title={t("artifact.dismiss", "Dismiss")}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
