import { useState, useCallback } from "react";
import { Search, Loader2, BookOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import { formatCitation, type ResourceResult } from "@/lib/editor/citationFormat";

interface ResourceSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the verse/hadith text and its formatted citation when the user inserts a result. */
  onInsert: (text: string, citation: string) => void;
  t: (k: string) => string;
}

const ResourceSearchDialog = ({ open, onOpenChange, onInsert, t }: ResourceSearchDialogProps) => {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResourceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async () => {
    if (!query.trim() || !session?.access_token) return;
    setIsSearching(true);
    setSearched(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resource-search`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ query }),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        toast.error(err.error || t("editor.search_error"));
        setResults([]);
        return;
      }
      const data = await response.json();
      setResults(data.results ?? []);
    } catch {
      toast.error(t("editor.search_error"));
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [query, session, t]);

  const handleInsert = (r: ResourceResult) => {
    const citation = formatCitation(r.citation_ref, r.source_url);
    onInsert(r.content, citation);
    onOpenChange(false);
    toast.success(t("editor.reference_inserted"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            {t("editor.search_resources")}
          </DialogTitle>
          <DialogDescription>{t("editor.search_resources_hint")}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            dir={isRtlText(query) ? "rtl" : "ltr"}
            className={cn(isRtlText(query) && "text-right")}
            placeholder={t("editor.search_placeholder")}
          />
          <Button onClick={runSearch} disabled={isSearching || !query.trim()} className="gap-1.5 shrink-0">
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t("editor.search_btn")}
          </Button>
        </div>

        <ScrollArea className="max-h-[50vh] -mx-2 px-2">
          <div className="space-y-2">
            {results.map((r, i) => {
              const rtl = isRtlText(r.content);
              return (
                <div key={i} className="rounded-lg border border-border bg-muted/20 p-3 group">
                  <p
                    dir={rtl ? "rtl" : "ltr"}
                    className={cn("text-sm leading-relaxed line-clamp-4", rtl && "text-right")}
                  >
                    {r.content}
                  </p>
                  <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/60">
                    <span className="text-[11px] text-muted-foreground truncate">
                      {formatCitation(r.citation_ref, r.source_url)}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs shrink-0" onClick={() => handleInsert(r)}>
                      <Plus className="h-3.5 w-3.5" />
                      {t("editor.insert")}
                    </Button>
                  </div>
                </div>
              );
            })}
            {searched && !isSearching && results.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">{t("editor.no_results")}</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default ResourceSearchDialog;
