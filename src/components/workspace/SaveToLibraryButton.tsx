import React, { useState } from "react";
import { Library, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { libraryChunkService } from "@/lib/corpus/libraryChunkService";
import { runLibraryIngest } from "@/lib/corpus/ingestOrchestrator";
import { translateStored, translateStoredFormat } from "@/lib/i18n";
import { useLanguage } from "@/contexts/LanguageContext";

interface SaveToLibraryButtonProps {
  /** The finished OCR / transcription text. */
  text: string;
  /** Becomes the library item's title. */
  title: string;
  kind: "ocr" | "audio";
  className?: string;
}

/**
 * The bridge M2 promised and M4 owes: a finished OCR page or transcript can
 * join the searchable personal corpus instead of dying on the page that made
 * it (SPEC-M4 FR-2.8).
 *
 * The text is uploaded as a .txt through the same path as a book upload, so
 * extraction, chunking, embedding, cancellation and deletion all behave
 * identically — no second ingest pipeline.
 */
export const SaveToLibraryButton: React.FC<SaveToLibraryButtonProps> = ({
  text,
  title,
  kind,
  className,
}) => {
  const { t } = useLanguage();
  const { total } = useTokenBalance();
  const [saving, setSaving] = useState(false);

  if (import.meta.env.VITE_PERSONAL_CORPUS === "false") return null;

  const trimmed = text.trim();
  const estimatedCost = 5 * Math.max(1, Math.ceil(trimmed.length / 2000));

  const handleSave = async () => {
    if (!trimmed) {
      toast.error(translateStored("toast.library.empty"));
      return;
    }
    if ((total ?? 0) < estimatedCost) {
      toast.error(translateStoredFormat("toast.tokens.insufficient", { required: estimatedCost, available: total ?? 0 }));
      return;
    }

    const safeTitle = (title.trim() || t("library.untitled_title", "Untitled")).slice(0, 80);
    setSaving(true);
    try {
      const file = new File([trimmed], `${safeTitle}.txt`, { type: "text/plain" });
      const item = await libraryChunkService.uploadLibraryFile(file, kind);
      if (!item) throw new Error(t("library.upload_failed", "Upload failed"));

      toast.success(translateStored("toast.library.processing"));
      const final = await runLibraryIngest({ itemId: item.id });
      if (final.done) toast.success(translateStoredFormat("toast.library.searchable", { title: safeTitle }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translateStored("toast.library.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={handleSave}
      disabled={saving || !trimmed}
      title={t("library.save_to_library_cost", "Save to library (~{cost} tokens)").replace("{cost}", String(estimatedCost))}
      aria-label={t("library.save_to_library", "Save to library")}
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Library className="h-4 w-4" />}
      <span className="ms-1">{t("library.save_to_library", "Save to library")}</span>
    </Button>
  );
};
