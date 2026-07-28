import React, { useState } from "react";
import { Library, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { libraryChunkService } from "@/lib/corpus/libraryChunkService";
import { runLibraryIngest } from "@/lib/corpus/ingestOrchestrator";

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
  const { total } = useTokenBalance();
  const [saving, setSaving] = useState(false);

  if (import.meta.env.VITE_PERSONAL_CORPUS === "false") return null;

  const trimmed = text.trim();
  const estimatedCost = 5 * Math.max(1, Math.ceil(trimmed.length / 2000));

  const handleSave = async () => {
    if (!trimmed) {
      toast.error("محفوظ کرنے کے لیے کوئی متن نہیں۔");
      return;
    }
    if ((total ?? 0) < estimatedCost) {
      toast.error(`ٹوکن ناکافی ہیں: ${estimatedCost} درکار، بیلنس ${total ?? 0}۔`);
      return;
    }

    const safeTitle = (title.trim() || "بغیر عنوان").slice(0, 80);
    setSaving(true);
    try {
      const file = new File([trimmed], `${safeTitle}.txt`, { type: "text/plain" });
      const item = await libraryChunkService.uploadLibraryFile(file, kind);
      if (!item) throw new Error("اپلوڈ ناکام");

      toast.success("کتب خانے میں شامل — پس منظر میں پروسیس جاری ہے…");
      const final = await runLibraryIngest({ itemId: item.id });
      if (final.done) toast.success(`'${safeTitle}' اب کتب خانے میں تلاش کے قابل ہے۔`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "کتب خانے میں محفوظ نہ ہو سکا۔");
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
      title={`کتب خانے میں محفوظ کریں (~${estimatedCost} ٹوکن)`}
      aria-label="کتب خانے میں محفوظ کریں"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Library className="h-4 w-4" />}
      <span className="ms-1">کتب خانے میں محفوظ کریں</span>
    </Button>
  );
};
