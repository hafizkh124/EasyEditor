import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderOpen, FolderClosed, RefreshCw, ChevronRight, ChevronDown, FileText, FileType2,
  FileImage, File as FileIcon, Trash2, Pencil, FolderPlus, FilePlus, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/workspace/EmptyState";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { useProjectFolderContext } from "@/core/projectFolder/context";
import { markdownToHtml } from "@/lib/editor/htmlText";
import { logger } from "@/lib/logger";
import type { ProjectTreeNode } from "~shared/fs/projectTypes";

const log = logger.child("FilesPanel");

/**
 * Plan §3.3 — the 📁 فائلیں rail panel. A live tree of the open project folder;
 * `.docx`/`.rtf` open through the Word bridge, `.md`/`.txt` inline, `.pdf` in the
 * OS viewer (an in-app split reader is a follow-up). New file / folder, rename,
 * and a soft delete (to `.easyeditor/trash/`). Desktop-only.
 */

const ICON_FOR = (node: ProjectTreeNode): React.ComponentType<{ className?: string }> => {
  if (node.kind === "dir") return FolderClosed;
  switch (node.ext) {
    case ".docx":
    case ".rtf":
      return FileType2;
    case ".md":
    case ".txt":
      return FileText;
    case ".pdf":
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".webp":
      return FileImage;
    default:
      return FileIcon;
  }
};

export const FilesPanel: React.FC = () => {
  const { t } = useLanguage();
  const { insertIntoCanvas, activeDocumentId } = useWorkspace();
  const pf = useProjectFolderContext();
  const api = typeof window !== "undefined" ? window.electronAPI?.projectFolder : undefined;
  const root = pf.folder?.path ?? null;

  const [tree, setTree] = useState<ProjectTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const refreshTree = useCallback(async () => {
    if (!api?.listTree || !root) { setTree([]); return; }
    setLoading(true);
    try {
      setTree(await api.listTree(root));
    } catch (err) {
      log.warn("listTree failed", { err });
    } finally {
      setLoading(false);
    }
  }, [api, root]);

  useEffect(() => { void refreshTree(); }, [refreshTree]);

  // Re-read on an external change (a save, a rename, Word editing a file).
  useEffect(() => {
    if (!api?.onChanged) return;
    return api.onChanged(() => { void refreshTree(); });
  }, [api, refreshTree]);

  const openFile = useCallback(async (node: ProjectTreeNode) => {
    if (!root) return;
    setBusyPath(node.name);
    try {
      if (node.openAs === "editor-docx") {
        const html = await pf.importChapter(node.name);
        if (html == null) return;
        if (!activeDocumentId) { toast.info(t("files.open_a_doc_first", "Open a document first, then the file is inserted")); return; }
        insertIntoCanvas(html);
        toast.success(t("projectfolder.imported", "“{name}” inserted into the document").replace("{name}", node.base));
      } else if (node.openAs === "editor-text") {
        const { text } = await api!.readText!(root, node.name);
        if (!activeDocumentId) { toast.info(t("files.open_a_doc_first", "Open a document first, then the file is inserted")); return; }
        insertIntoCanvas(node.ext === ".md" ? markdownToHtml(text) : `<p>${text.replace(/\n/g, "</p><p>")}</p>`);
        toast.success(t("projectfolder.imported", "“{name}” inserted into the document").replace("{name}", node.base));
      } else {
        // An in-app PDF reader / generic file preview is a follow-up (plan §3.3).
        toast.info(t("files.no_preview", "No preview yet — open it from your file explorer"));
      }
    } catch (err) {
      log.warn("openFile failed", { err });
      toast.error(t("files.open_failed", "Could not open the file"));
    } finally {
      setBusyPath(null);
    }
  }, [root, pf, api, activeDocumentId, insertIntoCanvas, t]);

  const rename = useCallback(async (node: ProjectTreeNode) => {
    if (!api?.rename || !root) return;
    const next = window.prompt(t("files.rename_prompt", "نیا نام:"), node.base);
    if (!next || next === node.base || next.includes("/") || next.includes("\\")) return;
    const to = node.name.includes("/") ? `${node.name.slice(0, node.name.lastIndexOf("/"))}/${next}` : next;
    try { await api.rename(root, node.name, to); await refreshTree(); }
    catch (err) { toast.error((err as Error).message); }
  }, [api, root, refreshTree, t]);

  const del = useCallback(async (node: ProjectTreeNode) => {
    if (!api?.trash || !root) return;
    if (!window.confirm(t("files.delete_confirm", "“{name}” کو ردی میں بھیجیں؟").replace("{name}", node.base))) return;
    try { await api.trash(root, node.name); await refreshTree(); toast.success(t("files.trashed", "Moved to trash")); }
    catch (err) { toast.error((err as Error).message); }
  }, [api, root, refreshTree, t]);

  const newFile = useCallback(async () => {
    if (!api?.createFile || !root) return;
    const name = window.prompt(t("files.new_file_prompt", "نئی فائل کا نام (.md یا .txt):"), "notes.md");
    if (!name) return;
    try { await api.createFile(root, name, ""); await refreshTree(); }
    catch (err) { toast.error((err as Error).message); }
  }, [api, root, refreshTree, t]);

  const newFolder = useCallback(async () => {
    if (!api?.mkdir || !root) return;
    const name = window.prompt(t("files.new_folder_prompt", "نئے فولڈر کا نام:"), "");
    if (!name) return;
    try { await api.mkdir(root, name); await refreshTree(); }
    catch (err) { toast.error((err as Error).message); }
  }, [api, root, refreshTree, t]);

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const rows = useMemo(() => {
    const out: Array<{ node: ProjectTreeNode; depth: number }> = [];
    const walk = (nodes: ProjectTreeNode[], depth: number) => {
      for (const node of nodes) {
        out.push({ node, depth });
        if (node.kind === "dir" && expanded.has(node.name) && node.children?.length) {
          walk(node.children, depth + 1);
        }
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, expanded]);

  if (!pf.supported) {
    return <div className="p-4 text-xs text-muted-foreground">{t("files.desktop_only", "پراجیکٹ ایکسپلورر صرف ڈیسک ٹاپ ایپ میں دستیاب ہے۔")}</div>;
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
          {pf.folder ? <FolderOpen className="h-3.5 w-3.5 text-primary shrink-0" /> : <FolderClosed className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{pf.folder ? pf.folder.manifest.title : t("rail.files", "فائلیں")}</span>
        </span>
        {pf.folder && (
          <span className="flex items-center gap-0.5 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={newFile} title={t("files.new_file", "نئی فائل")}><FilePlus className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={newFolder} title={t("files.new_folder", "نیا فولڈر")}><FolderPlus className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refreshTree} title={t("common.refresh", "تازہ کریں")}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </span>
        )}
      </div>

      {!pf.folder ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={FolderClosed}
            title={t("files.no_folder_title", "کوئی پراجیکٹ فولڈر نہیں کھلا")}
            description={t("files.no_folder_desc", "اپنی ریسرچ فائلوں کا فولڈر کھولیں۔")}
            action={<Button size="sm" onClick={pf.openFolder}>{t("agent.open_folder_hint_short", "پراجیکٹ فولڈر کھولیں")}</Button>}
          />
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="py-1">
            {rows.map(({ node, depth }) => {
              const Icon = ICON_FOR(node);
              const isDir = node.kind === "dir";
              const isOpen = expanded.has(node.name);
              return (
                <div
                  key={node.name}
                  className="group flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-sidebar-accent/50"
                  style={{ paddingInlineStart: `${8 + depth * 12}px` }}
                >
                  <button
                    type="button"
                    onClick={() => (isDir ? toggle(node.name) : openFile(node))}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
                  >
                    {isDir ? (
                      isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0 rtl:rotate-180" />
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{node.base}</span>
                    {busyPath === node.name && <Loader2 className="h-3 w-3 animate-spin" />}
                  </button>
                  {!isDir && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={t("common.more", "مزید")}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={() => rename(node)}><Pencil className="me-2 h-3.5 w-3.5" />{t("common.rename", "نام بدلیں")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => del(node)} className="text-destructive focus:text-destructive"><Trash2 className="me-2 h-3.5 w-3.5" />{t("common.delete", "حذف کریں")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
            {rows.length === 0 && !loading && (
              <p className="px-3 py-4 text-xs text-muted-foreground">{t("files.empty", "فولڈر خالی ہے۔")}</p>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
