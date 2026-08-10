import React from "react";
import { FolderTree } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface CategoryGridProps {
  categories: Array<{
    id: number;
    name: string;
    parentId: number | null;
    bookCount: number;
  }>;
  loading: boolean;
}

export const CategoryGrid: React.FC<CategoryGridProps> = ({
  categories,
  loading,
}) => {
  if (loading && categories.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Browse by Category
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (categories.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Browse by Category
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center gap-2 rounded-lg border border-border/50 bg-card p-2.5 hover:border-primary/50 hover:bg-accent/50 transition-colors cursor-pointer"
          >
            <div className="rounded-md bg-primary/10 p-1.5">
              <FolderTree className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{cat.name}</p>
              <p className="text-xs text-muted-foreground">
                {cat.bookCount.toLocaleString()} books
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
