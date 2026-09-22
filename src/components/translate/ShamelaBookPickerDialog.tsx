import React, { useState } from "react";
import { FolderTree, Search, Library } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { BrowseTab } from "@/components/workspace/BrowseTab";
import { SearchTab } from "@/components/workspace/SearchTab";
import { useShamelaAvailability } from "@/hooks/useShamelaAvailability";
import type { ChunkSearchHit } from "@/core/backend/types";

type PickerTab = "browse" | "search";

interface ShamelaBookPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (bookId: string, title: string) => void;
}

/**
 * Book picker for Book Translation's Shamela source — the same Browse/Search
 * surfaces the Library panel's Shamela tab already offers (`ShamelaTab.tsx`),
 * repackaged into a modal so `/translate-book` doesn't need the workspace
 * shell. Deliberately Browse + Search only (no Favorites tab): both already
 * hand back a book id *and* title, which is what a fresh translation project
 * needs to name itself — see `BrowseTab.tsx`'s `onSelectBookWithTitle` and
 * `ChunkSearchHit.title`.
 */
export const ShamelaBookPickerDialog: React.FC<ShamelaBookPickerDialogProps> = ({
  open, onOpenChange, onSelect,
}) => {
  const { t } = useLanguage();
  const { available, checking } = useShamelaAvailability();
  const [tab, setTab] = useState<PickerTab>("browse");

  const handleSearchSelect = (hit: ChunkSearchHit) => {
    onSelect(hit.itemId, hit.title);
    onOpenChange(false);
  };

  const handleBrowseSelect = (bookId: string, title: string) => {
    onSelect(bookId, title);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[70vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Library className="h-5 w-5 text-primary" />
            {t("translate.pick_shamela_book", "مکتبہ شاملہ سے کتاب منتخب کریں")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("translate.pick_shamela_book_desc", "منتخب کردہ کتاب کے تمام صفحات ترجمے کے لیے تیار کیے جائیں گے۔")}
          </DialogDescription>
        </DialogHeader>

        {checking ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-muted-foreground">{t("library.detecting_shamela", "Detecting Shamela…")}</p>
          </div>
        ) : !available ? (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <p className="text-xs text-muted-foreground max-w-sm">
              {t(
                "translate.shamela_unavailable",
                "مکتبہ شاملہ فی الحال دستیاب نہیں۔ ویب پر استعمال کے لیے shamela-bridge کمپینین چلائیں اور منسلک کریں، یا ڈیسک ٹاپ ایپ استعمال کریں۔",
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="flex gap-1 px-4 pb-2 shrink-0">
              {([
                { id: "browse" as const, icon: FolderTree, label: t("library.tab_browse", "Browse") },
                { id: "search" as const, icon: Search, label: t("common.search", "Search") },
              ]).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                    tab === id ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 border-t border-border">
              {tab === "browse" && (
                <BrowseTab onSelectBookWithTitle={handleBrowseSelect} />
              )}
              {tab === "search" && (
                <SearchTab onSelectResult={handleSearchSelect} />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ShamelaBookPickerDialog;
