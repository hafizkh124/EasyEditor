import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getShamelaClient, type CatalogueBook } from "@/core/shamela/shamelaClient";
import { useLanguage } from "@/contexts/LanguageContext";
import { BATCH_MAX_ITEMS } from "../../../shared/agent/batch";
import type { ScopeReviewRequest, ScopeTag } from "@/hooks/useAgentRun";
import { logger } from "@/lib/logger";

const log = logger.child("ScopeReviewDialog");

type ExecMode = NonNullable<ScopeTag["execMode"]>;

/**
 * Plan §4.2 — before a `#` author / category / century becomes a scope chip,
 * the scholar sees the concrete book set, prunes it, and picks how the agent
 * should run over it. The execution mode is chosen HERE (not in the composer),
 * so no control appears or vanishes in the input bar (§4.2's stated reason).
 */
export const ScopeReviewDialog: React.FC<{
  request: ScopeReviewRequest | null;
  onConfirm: (tag: Omit<ScopeTag, "id">) => void;
  onClose: () => void;
}> = ({ request, onConfirm, onClose }) => {
  const { t } = useLanguage();
  const [books, setBooks] = useState<CatalogueBook[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [textFilter, setTextFilter] = useState("");
  const [intersectCategory, setIntersectCategory] = useState<number | undefined>();
  const [intersectCentury, setIntersectCentury] = useState<number | undefined>();
  const [mode, setMode] = useState<ExecMode>("search");
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);

  const filter = useMemo(() => {
    if (!request) return null;
    return {
      ...request.filter,
      ...(intersectCategory ? { categoryId: intersectCategory } : {}),
      ...(intersectCentury ? { century: intersectCentury } : {}),
    };
  }, [request, intersectCategory, intersectCentury]);

  // Resolve the set whenever the (possibly intersected) filter changes.
  useEffect(() => {
    if (!request || !filter) return;
    let cancelled = false;
    setLoading(true);
    const client = getShamelaClient();
    void (async () => {
      try {
        const [rows, count] = await Promise.all([
          client.listBooks(filter, 1000).catch(() => []),
          client.countBooks(filter).catch(() => 0),
        ]);
        if (cancelled) return;
        setBooks(rows);
        setTotal(count || rows.length);
        setSelected(new Set(rows.map((b) => b.id)));
      } catch (err) {
        log.warn("scope resolve failed", { err });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [request, filter]);

  useEffect(() => {
    if (!request) return;
    getShamelaClient().listCategories().then((c) => setCategories(c.map((x) => ({ id: x.id, name: x.name })))).catch(() => undefined);
  }, [request]);

  // Reset when a new request opens.
  useEffect(() => {
    if (request) {
      setTextFilter("");
      setIntersectCategory(undefined);
      setIntersectCentury(undefined);
      setMode("search");
    }
  }, [request]);

  const visible = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    if (!q) return books;
    return books.filter((b) => `${b.title} ${b.author ?? ""}`.toLowerCase().includes(q));
  }, [books, textFilter]);

  const authorCount = useMemo(() => new Set(books.filter((b) => selected.has(b.id)).map((b) => b.author)).size, [books, selected]);
  const selectedCount = selected.size;
  const overCap = selectedCount > BATCH_MAX_ITEMS;

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const confirm = useCallback(() => {
    if (!request) return;
    const refs = books.filter((b) => selected.has(b.id)).map((b) => `shamela:${b.id}`);
    onConfirm({
      kind: "#",
      label: `${request.label} · ${refs.length} ${t("scope.books_unit", "books")}`,
      ref: request.ref,
      scopeType: request.scopeType,
      resolvedBookRefs: refs,
      sourceFilter: filter ?? undefined,
      execMode: mode,
    });
  }, [request, books, selected, filter, mode, onConfirm, t]);

  const CENTURY_OPTS = Array.from({ length: 15 }, (_, i) => i + 1);

  return (
    <Dialog open={Boolean(request)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("scope.review_title", "Review scope")} — {request?.label}
            {total != null && (
              <span className="ms-2 text-xs font-normal text-muted-foreground">
                {t("scope.total_books", "{n} books").replace("{n}", String(total))}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              placeholder={t("scope.filter_placeholder", "Filter by title or author…")}
              className="h-8 ps-7 text-xs"
            />
          </div>
          {request?.scopeType !== "category" && (
            <select
              className="h-8 rounded border border-border bg-background px-2"
              value={intersectCategory ?? ""}
              onChange={(e) => setIntersectCategory(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">{t("scope.any_category", "Any category")}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {request?.scopeType !== "century" && (
            <select
              className="h-8 rounded border border-border bg-background px-2"
              value={intersectCentury ?? ""}
              onChange={(e) => setIntersectCentury(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">{t("scope.any_century", "Any century")}</option>
              {CENTURY_OPTS.map((c) => <option key={c} value={c}>{t("scope.century_n", "{n}th c. AH").replace("{n}", String(c))}</option>)}
            </select>
          )}
          <div className="ms-auto flex items-center gap-2">
            <button className="text-primary hover:underline" onClick={() => setSelected(new Set(books.map((b) => b.id)))}>
              {t("scope.select_all", "All")}
            </button>
            <button className="text-primary hover:underline" onClick={() => setSelected(new Set())}>
              {t("scope.select_none", "None")}
            </button>
          </div>
        </div>

        {/* Book list */}
        <div className="max-h-64 overflow-y-auto rounded border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading", "Loading…")}
            </div>
          ) : visible.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">{t("scope.no_books", "No books match this filter.")}</p>
          ) : (
            visible.map((b) => (
              <label key={b.id} className="flex cursor-pointer items-center gap-2 border-b border-border/50 px-2 py-1.5 text-xs last:border-0 hover:bg-muted">
                <input type="checkbox" className="accent-primary" checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
                <span className="flex-1 truncate">{b.title}</span>
                <span className="shrink-0 text-muted-foreground">{b.author ?? "—"}</span>
                {b.deathYear ? <span className="shrink-0 tabular-nums text-muted-foreground/70">{t("scope.death_ah", "{n} AH").replace("{n}", String(b.deathYear))}</span> : null}
              </label>
            ))
          )}
        </div>

        {/* Execution mode */}
        <fieldset className="grid gap-2 sm:grid-cols-3">
          {([
            ["search", t("scope.mode_search", "Search this set"), t("scope.mode_search_hint", "One run across all books")],
            ["per-book", t("scope.mode_per_book", "Per-book task"), t("scope.mode_per_book_hint", "{n} of {max}").replace("{n}", String(selectedCount)).replace("{max}", String(BATCH_MAX_ITEMS))],
            ...(authorCount > 1 ? [["per-author", t("scope.mode_per_author", "Per-author task"), t("scope.mode_per_author_hint", "{n} authors").replace("{n}", String(authorCount))]] as const : []),
          ] as const).map(([value, title, hint]) => {
            const disabled = value === "per-book" && overCap;
            return (
              <label
                key={value}
                className={`flex flex-col gap-0.5 rounded border p-2 text-xs ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${mode === value ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <input
                    type="radio"
                    name="scope-exec-mode"
                    className="accent-primary"
                    checked={mode === value}
                    disabled={disabled}
                    onChange={() => setMode(value as ExecMode)}
                  />
                  {title}
                </span>
                <span className="ps-5 text-muted-foreground">{hint}</span>
              </label>
            );
          })}
        </fieldset>

        {overCap && mode === "per-book" && (
          <p className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
            {t("scope.over_cap", "Over {max} — narrow with a category + century, or select fewer books.").replace("{max}", String(BATCH_MAX_ITEMS))}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button size="sm" onClick={confirm} disabled={selectedCount === 0}>
            {t("scope.confirm", "Confirm ({n} selected)").replace("{n}", String(selectedCount))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
