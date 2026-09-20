import React, { useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Layers,
  Search,
  Copy,
  Check,
  Loader2,
  Tag,
  Hash,
} from "lucide-react";
import type { LibraryItem } from "@/core/workspace/types";
import type { LibraryChunkInfo } from "@/core/backend/types";
import { libraryChunkService } from "@/lib/corpus/libraryChunkService";
import { toast } from "sonner";

interface ChunkInspectorDialogProps {
  item: LibraryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ChunkInspectorDialog: React.FC<ChunkInspectorDialogProps> = ({
  item,
  open,
  onOpenChange,
}) => {
  const [chunks, setChunks] = useState<LibraryChunkInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item) {
      setChunks([]);
      setSearchQuery("");
      return;
    }

    let active = true;
    setLoading(true);

    libraryChunkService
      .listChunks(item.id, 500)
      .then((data) => {
        if (active) setChunks(data);
      })
      .catch((err) => {
        if (active) {
          toast.error("چنکس لوڈ کرنے میں ناکامی: " + (err instanceof Error ? err.message : String(err)));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, item]);

  const chunkerVersion = (item?.meta as any)?.ingest?.chunker || "legacy";
  const totalReported = (item?.meta as any)?.ingest?.total_chunks ?? chunks.length;

  const filteredChunks = useMemo(() => {
    if (!searchQuery.trim()) return chunks;
    const q = searchQuery.toLowerCase();
    return chunks.filter(
      (c) =>
        c.content.toLowerCase().includes(q) ||
        String(c.chunk_index).includes(q) ||
        String(c.meta?.heading || "").toLowerCase().includes(q) ||
        String(c.meta?.isnad || "").toLowerCase().includes(q)
    );
  }, [chunks, searchQuery]);

  const copyContent = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("متن کاپی ہو گیا");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-6 overflow-hidden" dir="rtl">
        <DialogHeader className="pb-3 border-b border-border space-y-1 text-start">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              <DialogTitle className="text-lg font-bold">
                {item?.title || "چنک انسپکٹر"}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs gap-1 border-primary/40 text-primary">
                <Hash className="h-3 w-3" />
                کل چنکس: {totalReported}
              </Badge>
              <Badge
                variant={chunkerVersion === "adaptive-v1" ? "default" : "secondary"}
                className="text-xs"
              >
                {chunkerVersion === "adaptive-v1" ? "Adaptive v1 (ساختی)" : "Legacy Chunker"}
              </Badge>
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            دستاویز کے اندرونی چنکس، سند و متن کی اکائی، اور ابواب کی درجہ بندی کا تفصیلی معائنہ۔
          </DialogDescription>
        </DialogHeader>

        {/* Filter Input */}
        <div className="relative my-3">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="چنک کے متن، انڈیکس یا باب میں تلاش کریں..."
            className="ps-9 text-xs"
          />
        </div>

        {/* Content Area */}
        <ScrollArea className="flex-1 pe-2">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs">چنکس لوڈ ہو رہے ہیں...</span>
            </div>
          ) : filteredChunks.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-xs">
              {searchQuery ? "کوئی چنک اس تلاش پر پورا نہیں اترا۔" : "اس دستاویز کا کوئی چنک موجود نہیں ہے۔"}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredChunks.map((chunk) => {
                const metaKind = (chunk.meta?.kind as string) || (item?.kind ?? "prose");
                const heading = chunk.meta?.heading as string | undefined;
                const isnad = chunk.meta?.isnad as string | undefined;

                return (
                  <div
                    key={chunk.id || chunk.chunk_index}
                    className="p-3.5 rounded-lg border bg-card/60 hover:bg-card transition-colors space-y-2 border-border/80"
                  >
                    {/* Header Row */}
                    <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-foreground">
                          #{chunk.chunk_index}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {chunk.char_start} – {chunk.char_end} حروف
                        </Badge>
                        {chunk.page_number != null && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            ص {chunk.page_number}
                          </Badge>
                        )}
                        {metaKind && (
                          <Badge
                            variant="secondary"
                            className={`text-[10px] px-1.5 py-0 ${
                              metaKind === "hadith"
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                : metaKind === "fiqh"
                                ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {metaKind}
                          </Badge>
                        )}
                      </div>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => copyContent(chunk.content, chunk.id)}
                      >
                        {copiedId === chunk.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-600" />
                            <span>کاپی ہو گیا</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>کاپی</span>
                          </>
                        )}
                      </Button>
                    </div>

                    {/* Meta Breadcrumb / Isnad Tags */}
                    {heading && (
                      <div className="flex items-center gap-1.5 text-xs text-primary bg-primary/5 px-2 py-1 rounded border border-primary/10 font-medium">
                        <Tag className="h-3 w-3 shrink-0" />
                        <span className="truncate">{heading}</span>
                      </div>
                    )}

                    {isnad && (
                      <div className="text-[11px] text-muted-foreground bg-muted/40 px-2 py-1 rounded border border-border/40 font-serif">
                        <span className="font-semibold text-foreground/80">سند: </span>
                        <span className="truncate">{isnad}</span>
                      </div>
                    )}

                    {/* Chunk Text Body */}
                    <div className="text-xs text-foreground/90 font-serif leading-relaxed whitespace-pre-wrap bg-background/50 p-2.5 rounded border border-border/40 select-text">
                      {chunk.content}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
