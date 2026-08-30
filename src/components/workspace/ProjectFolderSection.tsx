import React from "react";
import { FolderOpen, FolderClosed, FileText, Download, Loader2, RefreshCw, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { useProjectFolderContext } from "@/core/projectFolder/context";
import { toast } from "sonner";

/**
 * SPEC-M8 P7 — the project-folder import list (ADR-0018). A folder of `.docx`
 * chapters, opened from disk; clicking a chapter converts it through Word and
 * drops the HTML into the editor. Export back to the folder is offered by the
 * Word export dialog. Desktop only.
 */
export const ProjectFolderSection: React.FC = () => {
  const { t } = useLanguage();
  const { insertIntoCanvas } = useWorkspace();
  const pf = useProjectFolderContext();

  if (!pf.supported) return null;

  const importChapter = async (name: string) => {
    const html = await pf.importChapter(name);
    if (html != null) {
      insertIntoCanvas(html);
      toast.success(t("projectfolder.imported", "“{name}” inserted into the document").replace("{name}", name));
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card/50 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground min-w-0">
          {pf.folder ? <FolderOpen className="h-3.5 w-3.5 text-primary shrink-0" /> : <FolderClosed className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="truncate">
            {pf.folder ? pf.folder.manifest.title : t("projectfolder.title", "Project folder")}
          </span>
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {pf.folder && (
            <>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => pf.refresh()} aria-label={t("projectfolder.refresh", "Refresh")}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={pf.closeFolder} aria-label={t("projectfolder.close", "Close folder")}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </span>
      </div>

      {!pf.folder ? (
        <Button size="sm" variant="outline" className="h-7 w-full gap-1.5 text-xs" onClick={pf.openFolder} disabled={pf.busy}>
          {pf.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
          {t("projectfolder.open", "Open a folder of .docx chapters")}
        </Button>
      ) : (
        <>
          {pf.externalChange && (
            <div className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 p-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="flex-1 truncate">
                {t("projectfolder.external_change", "“{name}” changed outside the app").replace("{name}", pf.externalChange)}
              </span>
              <button className="underline" onClick={pf.dismissExternalChange}>{t("projectfolder.dismiss", "Dismiss")}</button>
            </div>
          )}
          {pf.chapters.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1">{t("projectfolder.empty", "No .docx or .rtf files in this folder yet.")}</p>
          ) : (
            <ul className="space-y-0.5">
              {pf.chapters.map((c) => (
                <li key={c.name}>
                  <button
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-start text-xs hover:bg-muted/60 disabled:opacity-50"
                    onClick={() => importChapter(c.name)}
                    disabled={pf.busy}
                    title={t("projectfolder.import_hint", "Insert this chapter into the document")}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{c.name}</span>
                    <Download className="h-3 w-3 shrink-0 opacity-50" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
