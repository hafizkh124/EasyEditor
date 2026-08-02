import React from "react";
import { BookOpen, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { RecentItem } from "@/core/backend/types";

interface RecentBooksGridProps {
  items: RecentItem[];
  onSelectBook?: (itemId: string) => void;
  loading: boolean;
}

function getSourceInfo(item: RecentItem): { author?: string; shamelaBookId?: number } {
  const ref = item.sourceRef || {};
  return {
    author: ref.author as string | undefined,
    shamelaBookId: ref.shamelaBookId as number | undefined,
  };
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export const RecentBooksGrid: React.FC<RecentBooksGridProps> = ({
  items,
  onSelectBook,
  loading,
}) => {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Recently Read
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[3/4] w-full rounded-lg" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Recently Read
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {items.map((item) => {
          const { author } = getSourceInfo(item);
          return (
            <button
              key={item.itemId}
              onClick={() => onSelectBook?.(item.itemId)}
              className="group flex flex-col items-start text-left rounded-lg border border-border/50 bg-card p-3 hover:border-primary/50 hover:bg-accent/50 transition-colors cursor-pointer"
            >
              {/* Book Cover Placeholder */}
              <div className="w-full aspect-[3/4] rounded-md bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-2 group-hover:from-primary/20 group-hover:to-primary/10 transition-colors">
                <BookOpen className="h-8 w-8 text-primary/30 group-hover:text-primary/50 transition-colors" />
              </div>

              {/* Title */}
              <p className="text-xs font-medium leading-tight line-clamp-2 w-full">
                {item.title}
              </p>

              {/* Author */}
              {author && (
                <p className="text-[10px] text-muted-foreground truncate w-full mt-0.5">
                  {author}
                </p>
              )}

              {/* Time ago */}
              <div className="flex items-center gap-1 mt-1">
                <Clock className="h-2.5 w-2.5 text-muted-foreground/50" />
                <p className="text-[9px] text-muted-foreground/70">
                  {formatTimeAgo(item.accessedAt)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
