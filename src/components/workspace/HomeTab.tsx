import React, { useState, useEffect, useCallback } from "react";
import { BookOpen, Search, Upload, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getBackend } from "@/core/backend";
import { StatsBar } from "./StatsBar";
import { RecentBooksGrid } from "./RecentBooksGrid";
import { CategoryGrid } from "./CategoryGrid";
import type { RecentItem } from "@/core/backend/types";

interface HomeTabProps {
  onSearch?: () => void;
  onImport?: () => void;
  onOpenFile?: () => void;
  onSelectBook?: (itemId: string) => void;
}

interface ShamelaStats {
  totalBooks: number;
  totalAuthors: number;
  totalCategories: number;
}

interface ShamelaCategory {
  id: number;
  name: string;
  parentId: number | null;
  bookCount: number;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  onSearch,
  onImport,
  onOpenFile,
  onSelectBook,
}) => {
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [shamelaStats, setShamelaStats] = useState<ShamelaStats | null>(null);
  const [categories, setCategories] = useState<ShamelaCategory[]>([]);
  const [libraryCount, setLibraryCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const backend = getBackend();

      // Load recent items and library count from workspace backend
      const [recent, count] = await Promise.all([
        backend.library.getRecentItems(10),
        backend.library.getLibraryItemCount(),
      ]);
      setRecentItems(recent);
      setLibraryCount(count);

      // Load Shamela stats and categories if available
      try {
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.shamela) {
          const shamelaState = await electronAPI.shamela.detect();
          if (shamelaState?.installed && shamelaState.masterDbPath) {
            const [stats, cats] = await Promise.all([
              electronAPI.shamela.catalogueStats(shamelaState.masterDbPath),
              electronAPI.shamela.listCategories(shamelaState.masterDbPath),
            ]);
            setShamelaStats(stats);
            // Filter to top-level categories only (parentId === null)
            setCategories(cats.filter((c: ShamelaCategory) => c.parentId === null));
          }
        }
      } catch {
        // Shamela not available — that's fine, show library-only stats
      }
    } catch (err) {
      console.error("[HomeTab] Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-6">
        {/* Stats Bar */}
        <StatsBar
          libraryCount={libraryCount}
          shamelaStats={shamelaStats}
          loading={loading}
        />

        {/* Recent Books */}
        <RecentBooksGrid
          items={recentItems}
          onSelectBook={onSelectBook}
          loading={loading}
        />

        {/* Category Grid */}
        {categories.length > 0 && (
          <CategoryGrid
            categories={categories}
            loading={loading}
          />
        )}

        {/* Quick Actions */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Quick Actions
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onSearch}
              className="gap-2"
            >
              <Search className="h-3.5 w-3.5" />
              Search All Books
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onImport}
              className="gap-2"
            >
              <Upload className="h-3.5 w-3.5" />
              Import Books
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenFile}
              className="gap-2"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Open File
            </Button>
          </div>
        </div>

        {/* Empty State */}
        {!loading && libraryCount === 0 && recentItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground mb-2">
              Your Library is Empty
            </h3>
            <p className="text-sm text-muted-foreground/70 mb-4 max-w-xs">
              Import books from Shamela or open files to start building your
              library.
            </p>
            <Button onClick={onImport} className="gap-2">
              <Upload className="h-4 w-4" />
              Import Your First Book
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};
