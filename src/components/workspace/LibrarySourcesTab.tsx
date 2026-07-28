import { useEffect, useState, useCallback } from "react";
import { BookOpen, FileText, Database, Music, FileCheck, Bookmark, Plus, Trash2, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { libraryChunkService } from "@/lib/corpus/libraryChunkService";
import { runLibraryIngest } from "@/lib/corpus/ingestOrchestrator";
import { SourceUploadDialog } from "./SourceUploadDialog";
import type { LibraryItem } from "@/core/workspace/types";
import { toast } from "sonner";

const KIND_ICONS: Record<string, React.ElementType> = {
  book: BookOpen,
  pdf: FileText,
  audio: Music,
  ocr: FileCheck,
  reference: Database,
  note: Bookmark,
};

export function LibrarySourcesTab() {
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
      if (final.done) toast.success(`'${item.title}' مکمل ہو گئی۔`);
      else toast.info(`'${item.title}' ابھی نامکمل ہے۔`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "پروسیس دوبارہ نہ چل سکا۔");
    } finally {
      setResuming(null);
      refresh();
    }
  };

  const handleDelete = async (itemId: string, title: string) => {
    const ok = await libraryChunkService.deleteLibraryItem(itemId);
    if (ok) {
      toast.success(`'${title}' اور اس کے تمام ایمبیڈنگز حذف کر دیے گئے۔`);
      refresh();
    } else {
      toast.error("حذف کرنے میں ناکامی۔");
    }
  };

  return (
    <div className="flex flex-col h-full bg-background p-2" dir="rtl">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-primary">
          <Database className="h-4 w-4" />
          <span>کتب خانہ (Personal Corpus)</span>
        </div>
        {corpusEnabled && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => setUploadOpen(true)}
          >
            <Plus className="h-3 w-3" />
            کتاب اپلوڈ کریں
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 pe-1">
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground text-center py-8">
            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1 text-primary" />
            لوڈ ہو رہا ہے…
          </div>
        ) : items.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground text-center py-8 space-y-2">
            <Database className="h-8 w-8 mx-auto opacity-40 text-primary" />
            <p className="font-semibold text-foreground text-xs">آپ کا ذاتی کتب خانہ خالی ہے</p>
            <p className="text-[11px]">PDF، DOCX یا TXT اپلوڈ کریں تاکہ AI آپ کی کتابوں سے حوالہ جات نکال سکے۔</p>
            {corpusEnabled && (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs gap-1 mt-2 bg-primary"
                onClick={() => setUploadOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                پہلی کتاب اپلوڈ کریں
              </Button>
            )}
          </div>
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
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="capitalize">{item.kind}</span>
                        {ingestStatus === "ready" ? (
                          <Badge variant="outline" className="text-[9px] gap-0.5 px-1 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            محفوظ
                          </Badge>
                        ) : ingestStatus === "failed" ? (
                          <Badge variant="destructive" className="text-[9px] px-1 py-0">
                            نامکمل
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 gap-0.5">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
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
                        title="پروسیس جاری رکھیں"
                        aria-label={`'${item.title}' کا پروسیس جاری رکھیں`}
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
                      title="کتاب حذف کریں"
                      aria-label={`'${item.title}' حذف کریں`}
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
