import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { Layers, Search, Copy, Check, Loader2, Tag, Hash, AlertTriangle } from "lucide-react";
import type { LibraryItem } from "@/core/workspace/types";
import type { LibraryChunkInfo } from "@/core/backend/types";
import { libraryChunkService } from "@/lib/corpus/libraryChunkService";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";

/** Chunks fetched per request. A book can hold tens of thousands; never load them all. */
export const CHUNK_PAGE_SIZE = 100;

interface ChunkInspectorDialogProps {
  item: LibraryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);

export const ChunkInspectorDialog: React.FC<ChunkInspectorDialogProps> = ({ item, open, onOpenChange }) => {
  const { t, direction } = useLanguage();
  const [chunks, setChunks] = useState<LibraryChunkInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Bumped by "retry" to re-run the initial load.
  const [reloadKey, setReloadKey] = useState(0);

  const itemId = item?.id;

  useEffect(() => {
    if (!open || !itemId) {
      setChunks([]);
      setSearchQuery("");
      setError(null);
      setHasMore(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    libraryChunkService
      .listChunks(itemId, CHUNK_PAGE_SIZE, 0)
      .then((data) => {
        if (!active) return;
        setChunks(data);
        setHasMore(data.length === CHUNK_PAGE_SIZE);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, itemId, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!itemId || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await libraryChunkService.listChunks(itemId, CHUNK_PAGE_SIZE, chunks.length);
      setChunks((prev) => [...prev, ...data]);
      setHasMore(data.length === CHUNK_PAGE_SIZE);
    } catch (err) {
      toast.error(t("library.chunks.error", "Could not load chunks") + ": " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoadingMore(false);
    }
  }, [itemId, loadingMore, chunks.length, t]);

  const chunkerVersion = (item?.meta as any)?.ingest?.chunker || "legacy";
  const reportedTotal = (item?.meta as any)?.ingest?.total_chunks as number | undefined;
  const totalLabel = reportedTotal ?? chunks.length;

  const filteredChunks = useMemo(() => {
    if (!searchQuery.trim()) return chunks;
    const q = searchQuery.toLowerCase();
    return chunks.filter(
      (c) =>
        c.content.toLowerCase().includes(q) ||
        String(c.chunk_index).includes(q) ||
        String(c.meta?.heading || "").toLowerCase().includes(q) ||
        String(c.meta?.isnad || "").toLowerCase().includes(q),
    );
  }, [chunks, searchQuery]);

  const copyContent = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be refused (permissions, insecure context): say so
      // instead of leaving an unhandled rejection and a false "copied" toast.
      toast.error(t("library.chunks.copy_failed", "Could not copy"));
      return;
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success(t("library.chunks.copied_toast", "Text copied"));
  };

  const isAdaptive = chunkerVersion === "adaptive-v1";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-6 overflow-hidden" dir={direction}>
        <DialogHeader className="pb-3 border-b border-border space-y-1 text-start">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              <DialogTitle className="text-lg font-bold">
                {item?.title || t("library.chunks.title", "Chunk inspector")}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs gap-1 border-primary/40 text-primary">
                <Hash className="h-3 w-3" />
                {fill(t("library.chunks.total", "Total chunks: {n}"), { n: totalLabel })}
              </Badge>
              <Badge variant={isAdaptive ? "default" : "secondary"} className="text-xs">
                {isAdaptive
                  ? t("library.chunks.adaptive", "Adaptive v1 (structural)")
                  : t("library.chunks.legacy", "Legacy chunker")}
              </Badge>
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("library.chunks.desc", "Inspect this document's chunks, its isnad/matn units and chapter hierarchy.")}
          </DialogDescription>
        </DialogHeader>

        <div className="relative my-3">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("library.chunks.search_placeholder", "Search chunk text, index or chapter…")}
            className="ps-9 text-xs"
          />
        </div>

        {/* Radix wraps the viewport's children in a `display: table` div, which sizes to its widest
            unwrapped content: one long isnad line made every card wider than the dialog and clipped
            its text at the edge. Force a normal block so long lines wrap inside the card. */}
        <ScrollArea className="flex-1 pe-2 [&_[data-radix-scroll-area-viewport]>div]:!block">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs">{t("library.chunks.loading", "Loading chunks…")}</span>
            </div>
          ) : error ? (
            // A failed load is NOT the same as an empty book — say which one it is.
            <div role="alert" className="p-12 text-center flex flex-col items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <span className="text-xs text-destructive">
                {t("library.chunks.error", "Could not load chunks")}: {error}
              </span>
              <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                {t("library.chunks.retry", "Retry")}
              </Button>
            </div>
          ) : filteredChunks.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-xs">
              {searchQuery
                ? t("library.chunks.no_match", "No chunk matches this search.")
                : t("library.chunks.empty", "This document has no chunks.")}
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
                    className="p-3.5 rounded-lg border bg-card/60 hover:bg-card transition-colors space-y-2 border-border/80 min-w-0"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-foreground">#{chunk.chunk_index}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {fill(t("library.chunks.chars", "{start} – {end} chars"), {
                            start: chunk.char_start ?? "?",
                            end: chunk.char_end ?? "?",
                          })}
                        </Badge>
                        {chunk.page_number != null && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {fill(t("library.chunks.page", "p. {n}"), { n: chunk.page_number })}
                          </Badge>
                        )}
                        {metaKind && (
                          <Badge
                            variant="secondary"
                            className={`text-[10px] px-1.5 py-0 ${
                              metaKind === "hadith"
                                ? "bg-success/15 text-success"
                                : metaKind === "fiqh"
                                ? "bg-info/15 text-info"
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
                            <Check className="h-3 w-3 text-success" />
                            <span>{t("library.chunks.copied", "Copied")}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>{t("library.chunks.copy", "Copy")}</span>
                          </>
                        )}
                      </Button>
                    </div>

                    {heading && (
                      <div className="flex items-center gap-1.5 text-xs text-primary bg-primary/5 px-2 py-1 rounded border border-primary/10 font-medium">
                        <Tag className="h-3 w-3 shrink-0" />
                        <span className="break-words min-w-0">{heading}</span>
                      </div>
                    )}

                    {isnad && (
                      <div className="text-[11px] text-muted-foreground bg-muted px-2 py-1 rounded border border-border/40">
                        <span className="font-semibold text-foreground/80">{t("library.chunks.isnad", "Isnad")}: </span>
                        <span className="break-words">{isnad}</span>
                      </div>
                    )}

                    <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap bg-background/50 p-2.5 rounded border border-border/40 select-text">
                      {chunk.content}
                    </div>
                  </div>
                );
              })}

              {/* The list is paged: say how much of it is on screen, and let the user get the rest. */}
              <div className="flex flex-col items-center gap-2 pt-1 pb-2 text-xs text-muted-foreground">
                <span>
                  {fill(t("library.chunks.shown", "Showing {shown} of {total} chunks"), {
                    shown: chunks.length,
                    total: reportedTotal ?? (hasMore ? `${chunks.length}+` : chunks.length),
                  })}
                  {searchQuery && hasMore && ` — ${t("library.chunks.search_scope", "search covers the loaded chunks only")}`}
                </span>
                {hasMore && (
                  <Button size="sm" variant="outline" disabled={loadingMore} onClick={loadMore}>
                    {loadingMore && <Loader2 className="h-3 w-3 animate-spin me-1" />}
                    {t("library.chunks.load_more", "Load more")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
