import React, { useEffect, useState } from "react";
import { BookOpen, Loader2, Pin, PinOff, Search } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { Project } from "@/core/workspace/types";
import { pinnedSourcesOf, savePinnedSources, type PinnedSource } from "@/lib/sources/pinnedSources";
import { searchSources } from "@/lib/sources/searchSources";
import { logger } from "@/lib/logger";

const log = logger.child("PinSourcesDialog");

/**
 * Pin sources to a folder (SYSTEM-2026 §3): search books — Shamela, JKHSSN on
 * the desktop, and your own files — and pin or unpin them. Every chat in the
 * folder then answers from these.
 */
export const PinSourcesDialog: React.FC<{
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}> = ({ project, onOpenChange, onSaved }) => {
  const { t, direction } = useLanguage();
  const [pinned, setPinned] = useState<PinnedSource[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PinnedSource[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPinned(pinnedSourcesOf(project));
    setQuery("");
    setHits([]);
  }, [project]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      void searchSources(q).then((rows) => {
        if (!cancelled) {
          setHits(rows);
          setSearching(false);
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const isPinned = (ref: string) => pinned.some((s) => s.ref === ref);
  const toggle = (source: PinnedSource) =>
    setPinned((list) => (isPinned(source.ref) ? list.filter((s) => s.ref !== source.ref) : [...list, source]));

  const save = async () => {
    if (!project) return;
    setSaving(true);
    try {
      await savePinnedSources(project, pinned);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      log.error("saving pinned sources failed", { err });
      toast.error(t("sources.pin_failed"));
    } finally {
      setSaving(false);
    }
  };

  const row = (source: PinnedSource) => {
    const on = isPinned(source.ref);
    return (
      <li key={source.ref}>
        <button
          type="button"
          onClick={() => toggle(source)}
          aria-pressed={on}
          className="flex min-h-touch w-full items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-muted"
        >
          <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{source.label}</span>
            {source.sublabel && <span className="block truncate text-xs text-muted-foreground">{source.sublabel}</span>}
          </span>
          {on ? <PinOff className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <Pin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </button>
      </li>
    );
  };

  return (
    <Dialog open={project !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir={direction}>
        <DialogHeader className="text-start">
          <DialogTitle>{t("sources.pin_title", "اس فولڈر کے ذرائع")}</DialogTitle>
          <DialogDescription>
            {t("sources.pin_desc", "اس فولڈر کی ہر چیٹ انہی ذرائع سے جواب دے گی۔ چیٹ میں @ سے مزید جوڑ سکتے ہیں۔")}
          </DialogDescription>
        </DialogHeader>

        {pinned.length > 0 && (
          <section aria-labelledby="pinned-now" className="space-y-1">
            <h3 id="pinned-now" className="text-xs font-semibold text-muted-foreground">{t("sources.pinned", "پن شدہ")}</h3>
            <ul className="space-y-0.5">{pinned.map(row)}</ul>
          </section>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sources.search", "کتاب یا فائل تلاش کریں…")}
            aria-label={t("sources.search", "کتاب یا فائل تلاش کریں…")}
            className="ps-9"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {searching ? (
            <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("sources.searching", "تلاش جاری ہے…")}
            </p>
          ) : query.trim().length >= 2 && hits.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">{t("filespage.no_match", "تلاش سے کچھ نہیں ملا۔")}</p>
          ) : (
            <ul className="space-y-0.5">{hits.filter((h) => !isPinned(h.ref)).map(row)}</ul>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel", "منسوخ")}</Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>{t("common.save", "محفوظ کریں")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
