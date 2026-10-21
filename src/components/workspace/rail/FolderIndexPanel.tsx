import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpDown, ChevronDown, FilePlus2, FileText, Folder, FolderOpen, GripVertical, Hash } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { useAllDocuments } from "@/core/workspace/useAllDocuments";
import { documentService } from "@/core/workspace/documentService";
import type { Document, Project } from "@/core/workspace/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { sortDocuments, type SortMode } from "@/core/workspace/sortDocuments";

const log = logger.child("FolderIndexPanel");

/**
 * "اس فولڈر میں" (SYSTEM-2026 §3) — the folder's documents like a book's index:
 * the open document unfolds into its headings (the second level), and a click
 * on one takes the editor there. Order is the folder's own (drag to change),
 * or by name or date.
 *
 * With nothing open it lists the folders to pick one. Chats, pinned sources
 * and results join this panel once folders can hold them.
 */

const SORT_KEY = "workspace.folderIndex.sort";
/** Headings deeper than this stay out of the index; it is a contents list, not the outline of every paragraph. */
const MAX_LEVEL = 3;

function readSort(): SortMode {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === "name" || v === "date" ? v : "manual";
  } catch {
    return "manual";
  }
}

export const FolderIndexPanel: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { activeDocumentId, setActiveDocumentId, documentOutline, jumpToHeading } = useWorkspace();
  const { projects, docsMap, allDocs, loading, refresh } = useAllDocuments();
  const [sort, setSortState] = useState<SortMode>(readSort);
  const [pickedFolderId, setPickedFolderId] = useState<string | null>(null);
  const [order, setOrder] = useState<Document[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const folders = projects.filter((p) => p.kind !== "translation");
  const activeDoc = allDocs.find((d) => d.id === activeDocumentId);
  const folderId = activeDoc?.project_id ?? pickedFolderId;
  const folder: Project | undefined = folders.find((p) => p.id === folderId);

  const sorted = useMemo(() => sortDocuments(folder ? docsMap[folder.id] ?? [] : [], sort), [folder, docsMap, sort]);
  // A drag shows its new order at once; the saved order replaces it on refresh.
  const savedOrder = sorted.map((d) => `${d.id}:${d.sort_order}`).join(",");
  useEffect(() => setOrder(null), [savedOrder]);
  const docs = order ?? sorted;

  const setSort = (mode: SortMode) => {
    setSortState(mode);
    try {
      localStorage.setItem(SORT_KEY, mode);
    } catch { /* remembered until reload */ }
  };

  const open = (doc: Document) => {
    setActiveDocumentId(doc.id);
    navigate(`/workspace/${doc.id}`, { replace: true });
    onNavigate?.();
  };

  const createDocument = async () => {
    if (!folder) return;
    try {
      const created = await documentService.createDocument(folder.id, t("editor.untitled", "Untitled Document"));
      await refresh();
      open(created);
    } catch (err) {
      log.error("creating a document failed", { err });
      toast.error(t("folderindex.create_failed"));
    }
  };

  const drop = async (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = [...docs];
    const from = next.findIndex((d) => d.id === dragId);
    const to = next.findIndex((d) => d.id === targetId);
    if (from < 0 || to < 0) return;
    next.splice(to, 0, ...next.splice(from, 1));
    setOrder(next);
    setDragId(null);
    try {
      await Promise.all(
        next.map((d, i) => (d.sort_order === i ? null : documentService.updateDocument(d.id, { sort_order: i }))),
      );
      await refresh();
    } catch (err) {
      log.error("saving the order failed", { err });
      toast.error(t("folderindex.order_failed"));
      setOrder(null);
    }
  };

  const sortLabels: Record<SortMode, string> = {
    manual: t("folderindex.sort_manual", "اپنی ترتیب"),
    name: t("folderindex.sort_name", "نام سے"),
    date: t("folderindex.sort_date", "تاریخ سے"),
  };

  if (!folder) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center border-b border-border px-3 text-sm font-semibold">
          {t("folderindex.folders", "فولڈر")}
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setPickedFolderId(f.id)}
                className="flex min-h-touch w-full items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-muted"
              >
                <Folder className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex-1 truncate">{f.title}</span>
                <span className="text-xs text-muted-foreground">{docsMap[f.id]?.length ?? 0}</span>
              </button>
            </li>
          ))}
          {!loading && folders.length === 0 && (
            <li className="px-2 py-6 text-center text-xs text-muted-foreground">{t("folderindex.no_folders", "ابھی کوئی فولڈر نہیں۔")}</li>
          )}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border ps-3 pe-1">
        {activeDoc ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8 min-h-touch" onClick={() => setPickedFolderId(null)} aria-label={t("folderindex.folders", "فولڈر")} title={t("folderindex.folders", "فولڈر")}>
            <FolderOpen className="h-4 w-4 text-primary" aria-hidden="true" />
          </Button>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={folder.title}>{folder.title}</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 min-h-touch" aria-label={t("folderindex.sort", "ترتیب")} title={sortLabels[sort]}>
              <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortMode)}>
              {(Object.keys(sortLabels) as SortMode[]).map((mode) => (
                <DropdownMenuRadioItem key={mode} value={mode}>{sortLabels[mode]}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" className="h-8 w-8 min-h-touch" onClick={() => void createDocument()} aria-label={t("create.new_document", "نیا دستاویز")} title={t("create.new_document", "نیا دستاویز")}>
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <nav aria-label={t("folderindex.title", "اس فولڈر میں")} className="min-h-0 flex-1 overflow-y-auto p-2">
        <h3 className="px-2 pb-1 text-xs font-semibold text-muted-foreground">{t("folderindex.documents", "دستاویزات")}</h3>
        {docs.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">{t("filespage.folder_empty", "اس فولڈر میں ابھی کوئی دستاویز نہیں۔")}</p>
        ) : (
          <ul className="space-y-0.5">
            {docs.map((doc) => {
              const isOpen = doc.id === activeDocumentId;
              const draggable = sort === "manual" && docs.length > 1;
              return (
                <li
                  key={doc.id}
                  draggable={draggable}
                  onDragStart={() => setDragId(doc.id)}
                  onDragOver={(e) => draggable && e.preventDefault()}
                  onDrop={() => void drop(doc.id)}
                  onDragEnd={() => setDragId(null)}
                  className={cn(dragId === doc.id && "opacity-50")}
                >
                  <button
                    type="button"
                    onClick={() => open(doc)}
                    aria-current={isOpen ? "page" : undefined}
                    className={cn(
                      "group flex min-h-touch w-full items-center gap-2 rounded-md px-2 text-start text-sm transition-colors",
                      isOpen ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted",
                    )}
                  >
                    {draggable && <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden="true" />}
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className="truncate">{doc.title || t("editor.untitled", "بے عنوان")}</span>
                  </button>
                  {isOpen && (
                    <ul aria-label={t("folderindex.headings", "عنوانات")} className="ms-4 border-s border-border ps-2">
                      {documentOutline.map((h, index) =>
                        h.text && h.level <= MAX_LEVEL ? (
                          <li key={index}>
                            <button
                              type="button"
                              onClick={() => {
                                jumpToHeading(index);
                                onNavigate?.();
                              }}
                              className="flex min-h-touch w-full items-center gap-1.5 rounded-md px-2 text-start text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                              style={{ paddingInlineStart: `${0.5 + (h.level - 1) * 0.75}rem` }}
                            >
                              <Hash className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
                              <span className="truncate">{h.text}</span>
                            </button>
                          </li>
                        ) : null,
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="shrink-0 border-t border-border p-2">
        <Link
          to={`/files?folder=${encodeURIComponent(folder.id)}`}
          className="flex min-h-touch items-center justify-center rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t("filespage.back", "تمام فائلیں")}
        </Link>
      </div>
    </div>
  );
};
