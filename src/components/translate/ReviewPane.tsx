import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCheck, ChevronLeft, ChevronRight, Languages, Loader2, RefreshCw, ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";
import type { BookPage } from "@/hooks/useBookTranslation";
import { glossaryMisses, type GlossaryEntry } from "@/lib/translate/glossary";
import { pairParagraphs } from "@/lib/translate/paragraphs";

/**
 * Translation review (SYSTEM-2026 §6): the source and its translation
 * paragraph by paragraph, side by side on a wide screen and one card per pair
 * on a phone. Choosing a pair highlights both halves and opens it: the
 * translation is edited in place, re-translated with a request ("make it
 * more fluent"), or marked reviewed.
 */

const QUICK_REQUESTS: Array<{ key: TranslationKey; fallback: string }> = [
  { key: "translate.req_fluent", fallback: "زیادہ رواں کریں" },
  { key: "translate.req_literal", fallback: "اصل کے زیادہ قریب کریں" },
  { key: "translate.req_shorter", fallback: "مختصر کریں" },
  { key: "translate.req_terms", fallback: "اصطلاحات کی فہرست کی پابندی کریں" },
];

function dirOf(text: string): "rtl" | "ltr" {
  return isRtlText(text) ? "rtl" : "ltr";
}

export interface ReviewPaneProps {
  page: BookPage | undefined;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  glossary: readonly GlossaryEntry[];
  /** The current page's text as it streams in while it is being translated. */
  streamingText: string;
  /** A page-wide run (this page alone or the whole book) is in progress. */
  busy: boolean;
  retranslatingIndex: number | null;
  onTranslatePage: () => void;
  onUpdateParagraph: (index: number, text: string) => void;
  onToggleReviewed: (index: number) => void;
  onSetPageReviewed: (all: boolean) => void;
  onRetranslate: (index: number, request: string) => Promise<boolean>;
}

export function ReviewPane({
  page, currentPage, totalPages, onPageChange, glossary, streamingText, busy, retranslatingIndex,
  onTranslatePage, onUpdateParagraph, onToggleReviewed, onSetPageReviewed, onRetranslate,
}: ReviewPaneProps) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<number | null>(null);
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    setSelected(null);
    setPageInput(String(currentPage));
  }, [currentPage]);

  const { pairs, aligned } = useMemo(
    () => pairParagraphs(page?.sourceText, page?.translationText ?? ""),
    [page?.sourceText, page?.translationText],
  );
  const translated = Boolean(page?.translationText.trim());
  const reviewed = new Set(page?.reviewed ?? []);
  const reviewedCount = translated ? pairs.filter((_, i) => reviewed.has(i)).length : 0;
  const working = page?.status === "reading" || page?.status === "translating";

  const commitPageInput = () => {
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n)) onPageChange(n);
    else setPageInput(String(currentPage));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-1">
        <Button
          variant="ghost" size="icon" className="h-9 w-9 shrink-0"
          onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1}
          aria-label={t("translate.prev_page", "پچھلا صفحہ")}
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={commitPageInput}
            onKeyDown={(e) => { if (e.key === "Enter") commitPageInput(); }}
            className="h-8 w-14 text-center text-xs tabular-nums"
            aria-label={t("translate.page_number", "صفحہ نمبر")}
          />
          <span className="whitespace-nowrap tabular-nums">/ {totalPages || "…"}</span>
        </div>
        <Button
          variant="ghost" size="icon" className="h-9 w-9 shrink-0"
          onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages}
          aria-label={t("translate.next_page", "اگلا صفحہ")}
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Button>

        <div className="ms-auto flex items-center gap-2">
          {translated && (
            <>
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {t("translate.page_reviewed", "جائزہ: {done} از {total}")
                  .replace("{done}", String(reviewedCount)).replace("{total}", String(pairs.length))}
              </span>
              <Button
                variant="ghost" size="sm" className="h-9 gap-1.5 text-xs"
                onClick={() => onSetPageReviewed(reviewedCount < pairs.length)}
              >
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                {reviewedCount < pairs.length
                  ? t("translate.mark_page_reviewed", "پورا صفحہ جائزہ شدہ")
                  : t("translate.unmark_page_reviewed", "جائزہ کے نشان ہٹائیں")}
              </Button>
            </>
          )}
          {!working && !busy && (
            <Button variant={translated ? "ghost" : "default"} size="sm" className="h-9 gap-1.5 text-xs" onClick={onTranslatePage}>
              <Languages className="h-4 w-4" aria-hidden="true" />
              {translated ? t("translate.retranslate_page", "صفحہ دوبارہ ترجمہ کریں") : t("translate.translate_page", "یہ صفحہ ترجمہ کریں")}
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {!page ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
        ) : page.status === "reading" ? (
          <StatusNote icon={<ScanText className="h-5 w-5 animate-pulse text-primary" aria-hidden="true" />}>
            {t("translate.reading_page", "صفحہ پڑھا جا رہا ہے، پھر اس کا ترجمہ ہوگا…")}
          </StatusNote>
        ) : page.status === "translating" && !translated ? (
          <div className="space-y-3">
            <StatusNote icon={<Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />}>
              {t("translate.translating_page", "ترجمہ ہو رہا ہے…")}
            </StatusNote>
            {streamingText && (
              <p dir={dirOf(streamingText)} className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-start leading-loose">
                {streamingText}
              </p>
            )}
          </div>
        ) : pairs.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
            {page.imageBase64 && (
              <img
                src={`data:${page.mimeType ?? "image/jpeg"};base64,${page.imageBase64}`}
                alt={t("translate.page_image", "صفحے کی تصویر")}
                className="max-h-[50vh] rounded-lg border border-border object-contain"
              />
            )}
            <p className="text-sm text-muted-foreground">
              {page.imageBase64
                ? t("translate.read_first_hint", "یہ صفحہ پہلے پڑھا جائے گا، پھر پیراگراف بہ پیراگراف اس کا ترجمہ ہوگا۔")
                : t("translate.empty_page", "اس صفحے پر کوئی متن نہیں۔")}
            </p>
          </div>
        ) : (
          <ol className="mx-auto max-w-5xl space-y-2" aria-label={t("translate.review_pairs", "اصل اور ترجمہ")}>
            {!aligned && translated && (
              <li className="rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-xs text-foreground">
                {t("translate.unaligned_note", "اس صفحے کے پیراگراف ترجمے سے نہیں ملے، اس لیے پورے صفحے کا جائزہ ایک ساتھ ہوگا۔")}
              </li>
            )}
            {pairs.map((pair, i) => (
              <PairRow
                key={i}
                index={i}
                source={pair.source}
                translation={pair.translation}
                selected={selected === i}
                reviewed={translated && reviewed.has(i)}
                misses={glossaryMisses(pair.source, pair.translation, glossary)}
                retranslating={retranslatingIndex === i}
                editable={translated && !busy}
                onSelect={() => setSelected((s) => (s === i ? s : i))}
                onClose={() => setSelected(null)}
                onCommit={(text) => onUpdateParagraph(i, text)}
                onToggleReviewed={() => onToggleReviewed(i)}
                onRetranslate={(request) => onRetranslate(i, request)}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function StatusNote({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="status" className="mx-auto flex max-w-md items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      {icon}
      <span>{children}</span>
    </div>
  );
}

function PairRow({
  index, source, translation, selected, reviewed, misses, retranslating, editable,
  onSelect, onClose, onCommit, onToggleReviewed, onRetranslate,
}: {
  index: number;
  source: string;
  translation: string;
  selected: boolean;
  reviewed: boolean;
  misses: GlossaryEntry[];
  retranslating: boolean;
  editable: boolean;
  onSelect: () => void;
  onClose: () => void;
  onCommit: (text: string) => void;
  onToggleReviewed: () => void;
  onRetranslate: (request: string) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(translation);
  const [askOpen, setAskOpen] = useState(false);
  const [request, setRequest] = useState("");
  const rowRef = useRef<HTMLLIElement>(null);

  // A new translation from outside (re-translate, a page run) replaces the draft.
  useEffect(() => setDraft(translation), [translation]);
  useEffect(() => {
    if (!selected) setAskOpen(false);
    else rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const commit = () => {
    if (draft.trim() && draft.trim() !== translation.trim()) onCommit(draft);
  };

  const send = async (text: string) => {
    commit();
    if (await onRetranslate(text)) {
      setAskOpen(false);
      setRequest("");
    }
  };

  const cellBase = "min-w-0 rounded-md px-3 py-2 text-start leading-loose transition-colors";
  const label = t("translate.pair_label", "پیراگراف {n}").replace("{n}", String(index + 1));

  return (
    <li
      ref={rowRef}
      className={cn(
        "rounded-lg border bg-card transition-colors",
        selected ? "border-primary/50 ring-2 ring-primary/20" : reviewed ? "border-success-border" : "border-border",
      )}
    >
      <div className="grid gap-px md:grid-cols-2">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`${label} — ${t("translate.source", "اصل")}`}
          dir={dirOf(source)}
          className={cn(cellBase, "whitespace-pre-wrap text-foreground/90", selected ? "bg-primary/5" : "hover:bg-muted")}
        >
          {source}
        </button>
        {selected && editable ? (
          <div className={cn(cellBase, "bg-primary/5")}>
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setDraft(translation); onClose(); }
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { commit(); onClose(); }
              }}
              dir={dirOf(draft)}
              aria-label={`${label} — ${t("translate.translation", "ترجمہ")}`}
              className="min-h-[6rem] resize-y bg-background text-start leading-loose"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            aria-label={`${label} — ${t("translate.translation", "ترجمہ")}`}
            dir={dirOf(translation)}
            className={cn(
              cellBase,
              "relative whitespace-pre-wrap",
              translation ? "text-foreground" : "text-muted-foreground",
              selected ? "bg-primary/5" : "hover:bg-muted",
            )}
          >
            {translation || t("translate.not_translated", "ابھی ترجمہ نہیں ہوا")}
            {reviewed && (
              <Check className="absolute end-2 top-2 h-4 w-4 text-success" aria-label={t("translate.reviewed", "جائزہ شدہ")} />
            )}
          </button>
        )}
      </div>

      {(misses.length > 0 || (selected && editable)) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-1.5">
          {misses.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("translate.glossary_missed", "اصطلاح کی پابندی نہیں ہوئی:")}{" "}
              {misses.map((m) => `${m.source} ← ${m.target}`).join("، ")}
            </span>
          )}
          {selected && editable && (
            <div className="ms-auto flex flex-wrap items-center gap-1">
              <Button
                variant={reviewed ? "secondary" : "ghost"} size="sm" className="h-9 gap-1.5 text-xs"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { commit(); onToggleReviewed(); }}
                aria-pressed={reviewed}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                {reviewed ? t("translate.reviewed", "جائزہ شدہ") : t("translate.mark_reviewed", "جائزہ مکمل")}
              </Button>
              <Button
                variant="ghost" size="sm" className="h-9 gap-1.5 text-xs"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setAskOpen((o) => !o)}
                aria-expanded={askOpen}
                disabled={retranslating}
              >
                {retranslating
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                {t("translate.retranslate_para", "ہدایت کے ساتھ دوبارہ ترجمہ")}
              </Button>
            </div>
          )}
        </div>
      )}

      {selected && editable && askOpen && (
        <div className="space-y-2 border-t border-border p-2">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REQUESTS.map((q) => (
              <Button
                key={q.key} variant="outline" size="sm" className="h-9 text-xs"
                disabled={retranslating}
                onClick={() => void send(t(q.key, q.fallback))}
              >
                {t(q.key, q.fallback)}
              </Button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); void send(request); }}
          >
            <Input
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder={t("translate.request_placeholder", "اپنی ہدایت لکھیں، مثلاً: «علماء» کی جگہ «اہلِ علم» لکھیں")}
              aria-label={t("translate.request_label", "دوبارہ ترجمے کی ہدایت")}
              className="h-9 flex-1 text-sm"
              disabled={retranslating}
            />
            <Button type="submit" size="sm" className="h-9" disabled={retranslating}>
              {retranslating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : t("translate.request_send", "بھیجیں")}
            </Button>
          </form>
        </div>
      )}
    </li>
  );
}
