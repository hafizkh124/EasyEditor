import React, { useState, useEffect, useCallback } from "react";
import { Search, User, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLanguage } from "@/contexts/LanguageContext";

export interface SplitBookChoice {
  bookId: string;
  title: string;
  author?: string;
}

interface CatalogueRow {
  id: number;
  title: string;
  author: string | null;
}

interface SplitBookPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (book: SplitBookChoice) => void;
  /** The book already open on the left, so the user can compare against it. */
  excludeBookId?: string | null;
}

const PICKER_LIMIT = 40;

/**
 * SPEC-M6 Phase 9 — Split View book picker.
 *
 * Searches the local Shamela catalogue (master.db via the native bridge) so
 * the user can choose a second book to compare against the one already open in
 * the reader.
 */
export const SplitBookPickerDialog: React.FC<SplitBookPickerDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
  excludeBookId,
}) => {
  const { t } = useLanguage();
  const [masterDbPath, setMasterDbPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect Shamela when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const api = window.electronAPI?.shamela;
    if (!api) {
      setError("Native Shamela bridge is unavailable.");
      setMasterDbPath(null);
      return;
    }
    api
      .detect()
      .then((state) => {
        if (cancelled) return;
        if (state?.installed && state.masterDbPath) {
          setMasterDbPath(state.masterDbPath);
          setError(null);
        } else {
          setMasterDbPath(null);
          setError("شاملہ ۴ نصب نہیں ہے۔");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to detect Shamela.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!masterDbPath) return;
      setLoading(true);
      try {
        const api = window.electronAPI!.shamela;
        const rows = await api.searchBooks(masterDbPath, q.trim(), PICKER_LIMIT);
        setResults(
          rows.map((r) => ({ id: r.id, title: r.title, author: r.author })),
        );
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        setLoading(false);
      }
    },
    [masterDbPath],
  );

  // Initial list + per-keystroke search.
  useEffect(() => {
    if (!open) return;
    setResults([]);
    runSearch(query);
  }, [open, query, runSearch]);

  const handleSelect = (row: CatalogueRow) => {
    onSelect({ bookId: String(row.id), title: row.title, author: row.author ?? undefined });
    onOpenChange(false);
  };

  const visible = excludeBookId ? results.filter((r) => String(r.id) !== excludeBookId) : results;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-0 text-start">
          <DialogTitle className="text-sm">{t("reader.split_picker.title")}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("reader.split_picker.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-3">
          <div className="relative">
            <Search className="absolute start-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("reader.split_picker.search")}
              className="h-9 ps-8 text-xs"
              autoFocus
            />
          </div>
        </div>

        <div className="p-5 pt-2">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {!error && loading && results.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!error && !loading && visible.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {query.trim() ? "No books found." : "Type a title or author to search."}
            </p>
          )}
          {visible.length > 0 && (
            <ScrollArea className="h-72">
              <ul>
                {visible.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(row)}
                      className="w-full text-start flex flex-col gap-0.5 px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <span className="text-xs font-medium leading-snug line-clamp-2">{row.title}</span>
                      {row.author && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {row.author}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
