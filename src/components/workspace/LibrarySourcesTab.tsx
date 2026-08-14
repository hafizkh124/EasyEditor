import { useEffect, useState, useCallback } from "react";
import { BookOpen, FileText, Database, Music, FileCheck, Bookmark, Plus, Trash2, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { libraryChunkService } from "@/lib/corpus/libraryChunkService";
import { runLibraryIngest } from "@/lib/corpus/ingestOrchestrator";
import { SourceUploadDialog } from "./SourceUploadDialog";
import { EmptyState } from "./EmptyState";
import type { LibraryItem } from "@/core/workspace/types";
import { toast } from "sonner";
import { translateStored, translateStoredFormat } from "@/lib/i18n";
import { useLanguage } from "@/contexts/LanguageContext";

const KIND_ICONS: Record<string, React.ElementType> = {
  book: BookOpen,
  pdf: FileText,
  audio: Music,
  ocr: FileCheck,
  reference: Database,
  note: Bookmark,
};

export function LibrarySourcesTab() {
  const { t } = useLanguage();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);

  const corpusEnabled = import.meta.env.VITE_PERSONAL_CORPUS !== "false";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await libraryChunkService.listLibraryItems();
      setItems(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Finish an ingest that was cancelled or interrupted (SPEC-M4 FR-2.5).
   *
   * Resumes from the offset the server recorded, so already-embedded chunks
   * are neither re-embedded nor re-charged.
   */
  const handleResumeIngest = async (item: LibraryItem) => {
    const ingest = (item.meta as Record<string, any>)?.ingest ?? {};
    setResuming(item.id);
    try {
      const final = await runLibraryIngest({
        itemId: item.id,
        startOffset: typeof ingest.next_offset === "number" ? ingest.next_offset : 0,
      });
      if (final.done) toast.success(translateStoredFormat("toast.library.item_complete", { title: item.title }));
      else toast.info(translateStoredFormat("toast.library.item_incomplete", { title: item.title }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translateStored("toast.library.retry_failed"));
    } finally {
      setResuming(null);
      refresh();
    }
  };

  const handleDelete = async (itemId: string, title: string) => {
    const ok = await libraryChunkService.deleteLibraryItem(itemId);
    if (ok) {
      toast.success(translateStoredFormat("toast.library.item_deleted", { title }));
      refresh();
    } else {
      toast.error(translateStored("toast.common.delete_failed"));
    }
  };

  return (
    <div className="flex flex-col h-full bg-background p-3">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-primary">
          <Database className="h-4 w-4" />
          <span>{t("library.corpus_title", "Library (Personal Corpus)")}</span>
        </div>
        {corpusEnabled && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => setUploadOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("library.upload_book", "Upload book")}
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 pe-1">
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground text-center py-8">
            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1 text-primary" />
            {t("library.loading", "Loading…")}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={Database}
            title={t("library.corpus_empty", "Your personal library is empty")}
            description={t("library.corpus_empty_desc", "Upload a PDF, DOCX or TXT so the AI can draw citations from your books.")}
            action={corpusEnabled && (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs gap-1 bg-primary"
                onClick={() => setUploadOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("library.upload_first_book", "Upload your first book")}
              </Button>
            )}
          />
        ) : (
          <div className="space-y-1.5">
            {items.map((item) => {
              const Icon = KIND_ICONS[item.kind] || Database;
              const ingestStatus = (item.meta as any)?.ingest?.status || "ready";
              const progress = (item.meta as any)?.ingest?.progress || 100;

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent/40 text-xs transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Icon className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate text-foreground text-xs">{item.title}</p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="capitalize">{item.kind}</span>
                        {ingestStatus === "ready" ? (
                          <Badge variant="outline" className="text-xs gap-0.5 px-1 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                            <CheckCircle2 className="h-3 w-3" />
                            {t("library.saved_badge", "Saved")}
                          </Badge>
                        ) : ingestStatus === "failed" ? (
                          <Badge variant="destructive" className="text-xs px-1 py-0">
                            {t("library.incomplete_badge", "Incomplete")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs px-1 py-0 gap-0.5">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {progress}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    {/* Anything not finished can be finished: cancelled runs and
                        failed extractions both resume from where they stopped. */}
                    {corpusEnabled && ingestStatus !== "ready" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                        onClick={() => handleResumeIngest(item)}
                        disabled={resuming === item.id}
                        title={t("library.resume_process", "Resume process")}
                        aria-label={t("library.resume_process_aria", "Resume process for '{title}'").replace("{title}", item.title)}
                      >
                        {resuming === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDelete(item.id, item.title)}
                      title={t("library.delete_book", "Delete book")}
                      aria-label={t("library.delete_book_aria", "Delete '{title}'").replace("{title}", item.title)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <SourceUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSuccess={refresh}
      />
    </div>
  );
}
