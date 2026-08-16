import React from "react";
import { BookOpen, Users, FolderTree } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/contexts/LanguageContext";

interface StatsBarProps {
  libraryCount: number;
  shamelaStats: {
    totalBooks: number;
    totalAuthors: number;
    totalCategories: number;
  } | null;
  loading: boolean;
}

export const StatsBar: React.FC<StatsBarProps> = ({
  libraryCount,
  shamelaStats,
  loading,
}) => {
  const { t } = useLanguage();
  const stats = [
    {
      icon: BookOpen,
      label: t("library.stat_library_books", "Library Books"),
      value: libraryCount,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      icon: BookOpen,
      label: t("library.stat_shamela_books", "Shamela Books"),
      value: shamelaStats?.totalBooks ?? null,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      icon: Users,
      label: t("library.stat_authors", "Authors"),
      value: shamelaStats?.totalAuthors ?? null,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
    {
      icon: FolderTree,
      label: t("library.stat_categories", "Categories"),
      value: shamelaStats?.totalCategories ?? null,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {t("library.overview", "Overview")}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3"
          >
            <div className={`rounded-md p-2 ${stat.bgColor}`}>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <div className="min-w-0">
              {loading ? (
                <Skeleton className="h-5 w-12" />
              ) : (
                <p className="text-lg font-semibold leading-none">
                  {stat.value !== null ? stat.value.toLocaleString() : "—"}
                </p>
              )}
              <p className="text-xs text-muted-foreground truncate">
                {stat.label}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
