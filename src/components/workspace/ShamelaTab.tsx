import React, { useState } from "react";
import { FolderTree, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { BrowseTab } from "./BrowseTab";
import { SearchTab } from "./SearchTab";
import { FavoritesTab } from "./FavoritesTab";
import type { ChunkSearchHit } from "@/core/backend/types";

type ShamelaSubTab = "browse" | "search" | "favorites";

interface ShamelaTabProps {
  onSelectBrowseBook: (bookId: string) => void;
  onSelectSearchResult: (hit: ChunkSearchHit) => void;
  onSelectFavoriteBook: (bookId: string) => void;
  onNavigate?: () => void;
  initialSubTab?: ShamelaSubTab;
}

const SUB_TABS: Array<{ value: ShamelaSubTab; icon: typeof FolderTree; labelKey: string; fallback: string }> = [
  { value: "browse", icon: FolderTree, labelKey: "library.tab_browse", fallback: "Browse" },
  { value: "search", icon: Search, labelKey: "common.search", fallback: "Search" },
  { value: "favorites", icon: Star, labelKey: "library.favorites", fallback: "Favorites" },
];

/**
 * Browse/Search/Favorites are all views over the same native Shamela install
 * (see useShamelaAvailability in LibraryPanel) — merged into one top-level
 * Library tab with its own sub-nav instead of three separate top-level tabs,
 * per P5's tab-count reduction.
 */
export const ShamelaTab: React.FC<ShamelaTabProps> = ({
  onSelectBrowseBook, onSelectSearchResult, onSelectFavoriteBook, onNavigate, initialSubTab,
}) => {
  const { t } = useLanguage();
  const [subTab, setSubTab] = useState<ShamelaSubTab>(initialSubTab ?? "browse");

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-1 px-2 pt-2 pb-1.5 border-b border-sidebar-border shrink-0">
        {SUB_TABS.map(({ value, icon: Icon, labelKey, fallback }) => (
          <button
            key={value}
            type="button"
            onClick={() => setSubTab(value)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
              subTab === value
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(labelKey as import("@/lib/i18n").TranslationKey, fallback)}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {subTab === "browse" && <BrowseTab onSelectBook={onSelectBrowseBook} onNavigate={onNavigate} />}
        {subTab === "search" && <SearchTab onSelectResult={onSelectSearchResult} onNavigate={onNavigate} />}
        {subTab === "favorites" && <FavoritesTab onSelectBook={onSelectFavoriteBook} />}
      </div>
    </div>
  );
};
