import React from "react";
import { BookOpen, AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";

export interface ImportEstimate {
  books: Array<{
    bookId: number;
    title: string;
    author: string | null;
    pageCount: number;
    estimatedChunks: number;
  }>;
  totalBooks: number;
  totalPages: number;
  totalChunks: number;
  approximate: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimate: ImportEstimate | null;
  loading?: boolean;
  onConfirm: () => void;
}

/**
 * The mandatory aggregate estimate before a Shamela import (SPEC-M5 FR-5.4).
 *
 * Deliberately NOT SolvencyDialog: that one is denominated in the cloud
 * token balance the web app meters. On desktop the app has no balance to
 * check — the embedding calls land on the user's own Gemini key and their own
 * Google bill, so the honest thing to show is the size of the job and whose
 * account pays for it (risk R7).
 *
 * Nothing has been read or sent when this opens: the numbers come from
 * Shamela's catalogue page counts alone.
 */
export const ImportEstimateDialog: React.FC<Props> = ({
  open, onOpenChange, estimate, loading, onConfirm,
}) => {
  const { t } = useLanguage();
  const hasBooks = (estimate?.totalBooks ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <BookOpen className="h-5 w-5 text-primary" />
            <span>{t("reader.import.estimate_title")}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("reader.import.estimate_description")}
          </DialogDescription>
        </DialogHeader>

        {loading || !estimate ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("reader.import.estimating")}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label={t("reader.import.books")} value={estimate.totalBooks.toLocaleString()} />
              <Stat label={t("reader.import.pages")} value={estimate.totalPages.toLocaleString()} />
              <Stat label={t("reader.import.chunks")} value={estimate.totalChunks.toLocaleString()} />
            </div>

            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("reader.import.google_cost")}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("reader.import.embedding_requests")} <strong>{estimate.totalChunks.toLocaleString()}</strong>{" "}
                {t("reader.import.google_billing")}
              </p>
              {estimate.approximate && (
                <p className="text-xs text-muted-foreground">
                  ⚠️ {t("reader.import.page_warning")}
                </p>
              )}
            </div>

            {hasBooks && (
              <ScrollArea className="max-h-40 rounded border border-border">
                {estimate.books.map((b) => (
                  <div
                    key={b.bookId}
                    className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2 text-xs last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{b.title}</div>
                      {b.author && <div className="truncate text-muted-foreground">{b.author}</div>}
                    </div>
                    <div className="shrink-0 text-muted-foreground">
                      {b.pageCount > 0 ? `${b.pageCount.toLocaleString()} ${t("reader.page")}` : t("reader.import.pages_unknown")}
                    </div>
                  </div>
                ))}
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter className="flex-row-reverse gap-2">
          <Button onClick={onConfirm} disabled={loading || !hasBooks} size="sm">
            {t("reader.import.start")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-border bg-muted/60 p-2">
    <div className="text-base font-semibold text-foreground">{value}</div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
);
