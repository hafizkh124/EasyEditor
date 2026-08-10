import React, { useRef, useState } from "react";
import { Upload, BookOpen, Loader2, Coins, AlertCircle } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { libraryChunkService } from "@/lib/corpus/libraryChunkService";
import { runLibraryIngest, type IngestProgress } from "@/lib/corpus/ingestOrchestrator";
import { IngestProgressCard } from "./IngestProgressCard";
import { translateStored, translateStoredFormat } from "@/lib/i18n";

interface SourceUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export const SourceUploadDialog: React.FC<SourceUploadDialogProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const { total } = useTokenBalance();
  const [file, setFile] = useState<File | null>(null);
  const [kind] = useState<"book" | "ocr" | "audio" | "custom">("book");
  const [isUploading, setIsUploading] = useState(false);
  const [ingestProgress, setIngestProgress] = useState<IngestProgress | null>(null);
  // Ingest of a 300-page book runs for minutes; the user must be able to stop
  // it, and the chunks already embedded stay (SPEC-M4 FR-2.5).
  const abortRef = useRef<AbortController | null>(null);

  // Estimate chunks and token cost: ~1200 chars/chunk, 5 tokens per 2000 chars (~5 tokens/chunk)
  const estimatedChunks = file ? Math.max(1, Math.ceil(file.size / 1200)) : 0;
  const estimatedCost = estimatedChunks * 5;
  const available = total ?? 100;
  const isSolvent = available >= estimatedCost;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    if (!isSolvent) {
      toast.error(translateStoredFormat("toast.tokens.book_insufficient", { required: estimatedCost, available }));
      return;
    }

    setIsUploading(true);
    try {
      const item = await libraryChunkService.uploadLibraryFile(file, kind);
      if (!item) throw new Error("اپلوڈ ناکام ہو گیا");

      toast.success(translateStored("toast.library.file_saved"));

      const controller = new AbortController();
      abortRef.current = controller;

      runLibraryIngest({
        itemId: item.id,
        signal: controller.signal,
        onProgress: (p) => setIngestProgress(p),
      })
        .then((final) => {
          onSuccess?.();
          if (final.done) {
            toast.success(translateStored("toast.library.processing_done"));
            onOpenChange(false);
          } else {
            // Cancelled: everything embedded so far is already stored, and the
            // Sources tab offers "جاری رکھیں" to finish the rest.
            toast.info(translateStoredFormat("toast.library.cancelled", { count: final.inserted }));
          }
        })
        .catch((err) => {
          onSuccess?.();
          toast.error(translateStoredFormat("toast.library.processing_failed", { error: err.message }));
        })
        .finally(() => {
          abortRef.current = null;
        });
    } catch (err: any) {
      toast.error(translateStoredFormat("toast.library.upload_failed", { error: err.message }));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-primary">
            <BookOpen className="h-5 w-5" />
            ذاتی کتب خانے میں کتاب / دستاویز اپلوڈ کریں
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            PDF, DOCX, TXT, یا MD فائل منتخب کریں۔ متن نکال کر کتب خانے کی محفوظ تلاش کے لیے تیار کیا جائے گا۔
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="file-upload" className="text-xs font-medium">فائل منتخب کریں</Label>
            <Input
              id="file-upload"
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={handleFileChange}
              disabled={isUploading}
              className="text-xs"
            />
          </div>

          {file && (
            <div className="p-3 bg-muted rounded-lg space-y-2 border text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground truncate">{file.name}</span>
                <span className="text-muted-foreground">({Math.round(file.size / 1024)} KB)</span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border/50 text-xs">
                <span className="text-muted-foreground">تخمینی chunks: ~{estimatedChunks}</span>
                <span className="flex items-center gap-1 font-medium text-primary">
                  <Coins className="h-3.5 w-3.5" />
                  تخمینی لاگت: {estimatedCost} ٹوکن
                </span>
              </div>

              {!isSolvent && (
                <div className="flex items-center gap-1.5 text-destructive text-xs font-medium pt-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>ٹوکن ناکافی ہیں! بیلنس: {available}</span>
                </div>
              )}
            </div>
          )}

          {ingestProgress && (
            <IngestProgressCard
              title={file?.name ?? "کتاب"}
              progress={ingestProgress}
              onCancel={() => abortRef.current?.abort()}
            />
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isUploading}>
            منسوخ کریں
          </Button>
          <Button
            size="sm"
            onClick={handleUpload}
            disabled={!file || isUploading || !isSolvent}
            className="gap-1.5 bg-primary hover:bg-primary/90"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            اپلوڈ اور پروسیس کریں
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
