import React, { useState, useEffect, useCallback } from "react";
import { Star, BookOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { readerService } from "@/core/workspace/readerService";
import { BookCover } from "@/components/shamela/BookCover";
import type { ReaderFavorite, ReadingProgress } from "@/core/backend/types";

interface FavoritesTabProps {
  onSelectBook?: (bookId: string) => void;
}

/**
 * SPEC-M6 Phase 8: Favorites tab in the Library panel. Lists books the reader
 * marked as favorites (by Shamela book id), with the last-read page when
 * progress exists. Clicking a favorite opens the reader on that page.
 */
export const FavoritesTab: React.FC<FavoritesTabProps> = ({ onSelectBook }) => {
  const [favorites, setFavorites] = useState<ReaderFavorite[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, ReadingProgress>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [favs, progress] = await Promise.all([
        readerService.listFavorites(),
        readerService.listReadingProgress(50),
      ]);
      setFavorites(favs);
      const map: Record<string, ReadingProgress> = {};
      for (const p of progress) map[p.bookId] = p;
      setProgressMap(map);
    } catch {
      // Reader state is best-effort.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = async (bookId: string) => {
    await readerService.removeFavorite(bookId);
    setFavorites((prev) => prev.filter((f) => f.bookId !== bookId));
  };

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[3/4] w-full rounded-lg" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <Star className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <h3 className="text-sm font-semibold text-muted-foreground mb-1">
          No favorites yet
        </h3>
        <p className="text-xs text-muted-foreground/70 max-w-[240px]">
          Tap the star in the reader toolbar to save books here for quick
          access.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
          Favorites
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {favorites.map((fav) => {
            const progress = progressMap[fav.bookId];
            const pct =
              progress && progress.pageCount > 0
                ? Math.round((progress.pageNumber / progress.pageCount) * 100)
                : 0;
            return (
              <button
                key={fav.bookId}
                onClick={() => onSelectBook?.(fav.bookId)}
                className="group relative flex flex-col items-start text-left rounded-lg border border-border/50 bg-card p-3 hover:border-primary/50 hover:bg-accent/50 transition-colors cursor-pointer"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1 end-1 h-7 w-7 text-muted-foreground/60 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(fav.bookId);
                  }}
                  title="Remove from favorites"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>

                <BookCover
                  bookId={fav.bookId}
                  title={fav.title}
                  author={fav.author}
                  className="mb-2"
                />

                <p className="text-xs font-medium leading-tight line-clamp-2 w-full">
                  {fav.title}
                </p>
                {fav.author && (
                  <p className="text-[10px] text-muted-foreground truncate w-full mt-0.5">
                    {fav.author}
                  </p>
                )}
                {progress && progress.pageCount > 0 && (
                  <div className="w-full mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] text-muted-foreground/70">
                        Page {progress.pageNumber} / {progress.pageCount}
                      </span>
                      <span className="text-[9px] text-muted-foreground/70">{pct}%</span>
                    </div>
                    <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 px-1 pt-1 text-[11px] text-muted-foreground/70">
          <BookOpen className="h-3 w-3" />
          Click a book to continue reading from where you left off.
        </div>
      </div>
    </ScrollArea>
  );
};
