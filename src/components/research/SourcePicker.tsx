import { useState } from "react";
import { Library, ChevronDown, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RESEARCH_SOURCES,
  SOURCE_GROUPS,
  ALL_SOURCE_IDS,
  type SourceGroupId,
} from "@/lib/research/sources";

interface SourcePickerProps {
  /** Selected domain ids. EMPTY means "everything" — see the note below. */
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  /** Corpus Atlas finding #7: restrict cited sources to rows that carry real
   *  Arabic matn (`content_ar`), not merely the corpus's declared reading
   *  language. Lives here rather than as a separate control because it is the
   *  same kind of narrowing as the source list, not a different feature. */
  requireArabicMatn: boolean;
  onRequireArabicMatnChange: (next: boolean) => void;
  disabled?: boolean;
  t: import("@/lib/i18n").Translator;
}

/**
 * Islamic-mode source selector.
 *
 * ADR-0002 removed the original domain checklist on the grounds that scholars
 * want everything queried in parallel and the checklist was "friction without
 * value". That reasoning still holds for the DEFAULT, and this control keeps
 * it: an empty selection means every source, the button reads "تمام مآخذ", and
 * nobody has to open the popover to ask a question. What ADR-0002 did not
 * anticipate is a corpus of 15 domains where the sources differ in kind — a
 * verified local corpus vs. a page scraped live from someone's site — so a
 * scholar who wants to cite only the corpus currently has no way to say so.
 * That is what this adds, as an opt-in narrowing, not a required step.
 * See ADR-0013.
 *
 * The empty-means-everything convention is not cosmetic: the backend reads
 * `selectedDomains ?? ALL_DOMAINS`, so sending `[]` would search nothing at
 * all. `toSelectedDomains()` in lib/research/sources.ts is the only place
 * allowed to make that translation.
 */
const SourcePicker = ({
  selected, onSelectedChange, requireArabicMatn, onRequireArabicMatnChange, disabled = false, t,
}: SourcePickerProps) => {
  const [open, setOpen] = useState(false);

  const isAll = selected.length === 0;
  const inGroup = (group: SourceGroupId) => RESEARCH_SOURCES.filter((s) => s.group === group);

  const toggle = (id: string) => {
    // First click out of the "everything" state materialises the full list so
    // unchecking one source does not silently drop the other seventeen.
    const base = isAll ? ALL_SOURCE_IDS : selected;
    const next = base.includes(id) ? base.filter((s) => s !== id) : [...base, id];
    // Back to a full house — store it as "everything" so the label stays
    // honest and the request keeps using the backend default.
    onSelectedChange(next.length === ALL_SOURCE_IDS.length ? [] : next);
  };

  const setGroup = (group: SourceGroupId, on: boolean) => {
    const ids = inGroup(group).map((s) => s.id);
    const base = isAll ? ALL_SOURCE_IDS : selected;
    const next = on
      ? [...new Set([...base, ...ids])]
      : base.filter((s) => !ids.includes(s));
    onSelectedChange(next.length === ALL_SOURCE_IDS.length ? [] : next);
  };

  const narrowed = !isAll || requireArabicMatn;
  const label = isAll
    ? t("research.sources_all")
    : `${selected.length} ${t("research.sources_unit")}`;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("research.sources_label")}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
          narrowed
            ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
            : "border-border bg-muted text-foreground hover:bg-accent",
        )}
      >
        <Library className="h-3.5 w-3.5 shrink-0" />
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={t("research.sources_label")}
            dir="rtl"
            className="absolute bottom-full mb-1 start-0 z-50 w-[min(21rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover shadow-md"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="text-xs font-medium text-foreground">
                {t("research.sources_heading")}
              </span>
              {narrowed && (
                <button
                  type="button"
                  onClick={() => { onSelectedChange([]); onRequireArabicMatnChange(false); }}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t("research.sources_reset")}
                </button>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-2 border-b border-border px-3 py-2 hover:bg-muted transition-colors">
              <input
                type="checkbox"
                checked={requireArabicMatn}
                onChange={(e) => onRequireArabicMatnChange(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">
                  {t("research.arabic_matn_only")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("research.arabic_matn_only_note")}
                </span>
              </span>
            </label>

            <div className="max-h-80 overflow-y-auto p-1">
              {SOURCE_GROUPS.map((group) => {
                const items = inGroup(group.id);
                const checkedCount = items.filter(
                  (s) => isAll || selected.includes(s.id),
                ).length;
                return (
                  <div key={group.id} className="mb-1 last:mb-0">
                    <div className="flex items-center justify-between gap-2 px-2 py-1">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground">{group.ur}</div>
                        <div className="text-xs text-muted-foreground truncate">{group.note}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setGroup(group.id, checkedCount < items.length)}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        {checkedCount < items.length
                          ? t("research.sources_group_all")
                          : t("research.sources_group_none")}
                      </button>
                    </div>

                    {items.map((source) => {
                      const checked = isAll || selected.includes(source.id);
                      return (
                        <label
                          key={source.id}
                          className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(source.id)}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-foreground">{source.ur}</span>
                            <span className="block text-xs text-muted-foreground">{source.note}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {isAll
                ? t("research.sources_hint_all")
                : t("research.sources_hint_some")}
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default SourcePicker;
