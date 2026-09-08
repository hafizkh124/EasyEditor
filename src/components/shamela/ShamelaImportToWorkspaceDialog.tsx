import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, BookOpen, ListChecks } from "lucide-react";
import { getShamelaClient } from "@/core/shamela/shamelaClient";
import type { TocEntry } from "@/hooks/useReaderState";
import { htmlToTiptapJSON } from "@/core/workspace/bookSectionMigration";
import { documentService } from "@/core/workspace/documentService";
import { useLanguage } from "@/contexts/LanguageContext";
import { translateStored } from "@/lib/i18n";
import { logger } from "@/lib/logger";

const log = logger.child("ShamelaImportToWorkspaceDialog");

interface ShamelaImportToWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookId: string;
  bookTitle: string;
  author?: string;
  toc: TocEntry[];
  pageCount: number;
}

/**
 * "Import to Workspace" (UX-v1 P7 follow-up) — the whole book, or selected
 * chapters, become one editable workspace document. Distinct from the
 * existing desktop-only ShamelaImportDialog, which imports whole books into
 * the AI retrieval corpus (library_chunks), not an editable document — that
 * flow is untouched.
 *
 * Fetches the whole book in one call (`readBook` — one JVM spawn, see
 * reader.mjs/shamelaNative.ts) regardless of mode, then slices pages
 * client-side for the "selected chapters" case. A chapter's range runs from
 * its own TOC page to the next TOC entry at the same or shallower depth
 * (exclusive), or the end of the book for the last one — not simply "the
 * next TOC entry", which breaks when a sub-heading starts on the exact same
 * page as its parent.
 */
export function ShamelaImportToWorkspaceDialog({
  open,
  onOpenChange,
  bookId,
  bookTitle,
  author,
  toc,
  pageCount,
}: ShamelaImportToWorkspaceDialogProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"whole" | "chapters">("whole");
  const [selectedTitleIds, setSelectedTitleIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const toggleTitle = (titleId: string) => {
    setSelectedTitleIds((prev) => {
      const next = new Set(prev);
      if (next.has(titleId)) next.delete(titleId);
      else next.add(titleId);
      return next;
    });
  };

  const handleImport = async () => {
    if (mode === "chapters" && selectedTitleIds.size === 0) {
      toast.error(translateStored("toast.shamela_workspace_import.select_chapter"));
      return;
    }

    setImporting(true);
    setStatus(translateStored("shamela.workspace_import.fetching"));
    try {
      const book = await getShamelaClient().readBook(bookId);
      if (!book || book.pages.length === 0) {
        throw new Error(translateStored("toast.shamela_workspace_import.book_fetch_failed"));
      }

      let includedPages = book.pages;
      let documentTitle = bookTitle;

      if (mode === "chapters") {
        const sortedToc = [...toc].sort((a, b) => a.page - b.page);
        const ranges: Array<[number, number]> = [];
        const titles: string[] = [];
        for (let i = 0; i < sortedToc.length; i++) {
          const entry = sortedToc[i];
          if (!selectedTitleIds.has(entry.titleId)) continue;
          // The boundary is the next entry at the same or shallower depth —
          // not simply the next entry in page order, which would stop at the
          // selected entry's own first child when a sub-heading starts on
          // the exact same page as its parent (a real, common case).
          let endPage = pageCount;
          for (let j = i + 1; j < sortedToc.length; j++) {
            if (sortedToc[j].depth <= entry.depth) {
              endPage = sortedToc[j].page - 1;
              break;
            }
          }
          ranges.push([entry.page, endPage]);
          titles.push(entry.text);
        }
        includedPages = book.pages.filter((p) => {
          const n = Number.parseInt(p.page, 10);
          return ranges.some(([start, end]) => n >= start && n <= end);
        });
        documentTitle =
          titles.length === 1
            ? titles[0]
            : `${bookTitle} — ${translateStored("shamela.workspace_import.mode_chapters")}`;
      }

      setStatus(translateStored("shamela.workspace_import.preparing"));
      const html = includedPages
        .map((p) => {
          const body = p.text || "";
          const footnotes = p.footnotes
            ? `<div class="reader-footnotes" data-reader-footnotes>${p.footnotes}</div>`
            : "";
          return `${body}${footnotes}`;
        })
        .join("\n");

      if (!html.trim()) {
        throw new Error(translateStored("toast.shamela_workspace_import.no_text_found"));
      }

      const contentJson = htmlToTiptapJSON(html);
      const project = await documentService.createProject(bookTitle, "book", {
        shamelaBookId: bookId,
        author,
      });
      const doc = await documentService.createDocument(project.id, documentTitle, contentJson);

      toast.success(translateStored("toast.shamela_workspace_import.success"));
      onOpenChange(false);
      navigate(`/workspace/${doc.id}`);
    } catch (err) {
      log.error("import to workspace failed", { err });
      toast.error(
        err instanceof Error ? err.message : translateStored("toast.shamela_workspace_import.failed"),
      );
    } finally {
      setImporting(false);
      setStatus(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !importing && onOpenChange(next)}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {t("shamela.workspace_import.dialog_title", "Workspace میں درآمد کریں")}
          </DialogTitle>
          <DialogDescription>
            {bookTitle} — {t("shamela.workspace_import.dialog_description", "ایک قابلِ ترمیم دستاویز کے طور پر لائیں۔")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "whole" | "chapters")} dir="rtl">
            <label className="flex items-center gap-2 rounded-md border border-border p-2.5 cursor-pointer hover:bg-accent/40">
              <RadioGroupItem value="whole" />
              <div>
                <div className="text-sm font-medium">{t("shamela.workspace_import.mode_whole", "پوری کتاب")}</div>
                <div className="text-xs text-muted-foreground">
                  {pageCount} {t("shamela.workspace_import.pages_unit", "صفحات")}
                </div>
              </div>
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border p-2.5 cursor-pointer hover:bg-accent/40">
              <RadioGroupItem value="chapters" />
              <div className="flex items-center gap-1.5">
                <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{t("shamela.workspace_import.mode_chapters", "منتخب ابواب")}</span>
              </div>
            </label>
          </RadioGroup>

          {mode === "chapters" && (
            <ScrollArea className="h-56 rounded-md border border-border p-2">
              {toc.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2">
                  {t("shamela.workspace_import.no_toc", "فہرست ابواب دستیاب نہیں۔")}
                </p>
              ) : (
                <div className="space-y-1">
                  {toc.map((entry) => (
                    <label
                      key={entry.titleId}
                      className="flex items-center gap-2 rounded p-1.5 text-sm cursor-pointer hover:bg-accent/40"
                      style={{ paddingRight: `${(entry.depth + 1) * 10}px` }}
                    >
                      <Checkbox
                        checked={selectedTitleIds.has(entry.titleId)}
                        onCheckedChange={() => toggleTitle(entry.titleId)}
                      />
                      <span className="truncate">{entry.text}</span>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
          )}

          {status && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {status}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            {t("common.cancel", "منسوخ")}
          </Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin ms-1.5" /> : null}
            {t("shamela.workspace_import.confirm", "درآمد کریں")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
