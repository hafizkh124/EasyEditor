import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Upload, FileText, Library, ArrowRightLeft, FileEdit, Copy, Languages, Type, Image as ImageIcon,
  BookMarked, ChevronDown, Download, FlaskConical, Rows3, Columns2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { isRtlText } from "@/utils/textUtils";
import { useLanguage } from "@/contexts/LanguageContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { editorRoute } from "@/lib/routes";
import { useBookTranslation } from "@/hooks/useBookTranslation";
import { cancelJob, getJob } from "@/lib/jobs/jobStore";
import { askJobNotificationPermission } from "@/lib/jobs/notificationPermission";
import { takePendingBookFile } from "@/lib/translate/pendingBookFile";
import { GENRE_TRANSLATION_PROMPTS } from "@/lib/translationMemory";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { SolvencyDialog } from "@/components/workspace/SolvencyDialog";
import ChunkProgressBar from "@/components/workspace/ChunkProgressBar";
import BookPageViewer from "@/components/translate/BookPageViewer";
import TranslationOutput from "@/components/translate/TranslationOutput";
import { ShamelaBookPickerDialog } from "@/components/translate/ShamelaBookPickerDialog";
import { ReaderContent } from "@/components/shamela/ReaderContent";
import { ReviewPane } from "@/components/translate/ReviewPane";
import { GlossaryDialog } from "@/components/translate/GlossaryDialog";
import { buildBookHtml, type BookExportMode } from "@/lib/translate/bookExport";
import { pairParagraphs } from "@/lib/translate/paragraphs";
import type { TranslationStyle } from "@/lib/translate/glossary";
import type { ReaderPage } from "@/hooks/useReaderState";

const LANGUAGES = [
  { value: "ur", label: "اردو (Urdu)" },
  { value: "ar", label: "العربية (Arabic)" },
  { value: "en", label: "English" },
  { value: "fa", label: "فارسی (Persian)" },
  { value: "pa", label: "پنجابی (Punjabi)" },
  { value: "ps", label: "پښتو (Pashto)" },
];
const SOURCE_LANGUAGES = [{ value: "auto", label: "Auto-detect" }, ...LANGUAGES];

/** "Try a sample" translates this many pages first, to check the settings before a whole book. */
const SAMPLE_PAGES = 2;

type View = "review" | "page";

export default function TranslateBook() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const isMobile = useIsMobile();
  const workspaceCtx = useOptionalWorkspace();
  const tokenBalance = useTokenBalance();

  const [shamelaBookId, setShamelaBookId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [solvencyOpen, setSolvencyOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [view, setView] = useState<View>("review");
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(1);
  /** The pages the open cost dialog is about: the chosen range, or the sample. */
  const [runRange, setRunRange] = useState<[number, number]>([1, 1]);
  const [showTextInput, setShowTextInput] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const reuploadInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const location = useLocation();
  // Read once: the URL is replaced with the project id as soon as it exists, which drops this state.
  const [folderId] = useState(() => (location.state as { projectId?: string } | null)?.projectId ?? null);

  const book = useBookTranslation({
    folderId,
    onProjectId: (id) => {
      if (routeProjectId !== id) navigate(`/translate-book/${id}`, { replace: true });
    },
  });

  // Runs once on mount: resume an existing project, or pick up a PDF handed
  // off from Quick Translate's PDF button (setPendingBookFile). Neither path
  // applies twice, so this intentionally does not re-run on prop changes.
  useEffect(() => {
    if (routeProjectId && routeProjectId !== "new") {
      void book.resumeProject(routeProjectId);
      return;
    }
    const pending = takePendingBookFile();
    if (pending) void book.loadPdf(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setRangeFrom(1);
    setRangeTo(book.totalPages || 1);
  }, [book.totalPages]);

  // "Resume" from the jobs strip: once the book is loaded again, carry on
  // from the first untranslated page of the same range (SYSTEM-2026 §9).
  const [continueJob] = useState(() => (location.state as { continueJob?: string } | null)?.continueJob ?? null);
  const continuedRef = useRef(false);
  useEffect(() => {
    if (!continueJob || continuedRef.current || book.isLoadingSource || book.pages.length === 0 || book.batch || book.backgroundRun) return;
    continuedRef.current = true;
    const meta = getJob(continueJob)?.meta as { from?: number; to?: number } | undefined;
    void book.translateAll(meta?.from ?? 1, meta?.to ?? book.pages.length);
  }, [continueJob, book]);

  const currentBookPage = book.pages.find((p) => p.pageNum === book.currentPage);
  const hasSource = book.sourceKind !== null;
  const needsResume = !hasSource && !!book.projectId && !book.isLoadingSource;
  const needsPdfReupload = needsResume && book.resumeSourceRef === "pdf";
  const needsFreshStart = needsResume && !needsPdfReupload;

  const isBook = book.sourceKind === "pdf" || book.sourceKind === "shamela";
  const estimate = book.estimateBatch(runRange[0], runRange[1]);

  const openRun = (from: number, to: number) => {
    const max = book.totalPages || book.pages.length || 1;
    const lo = Math.min(Math.max(1, from), max);
    setRunRange([lo, Math.min(Math.max(lo, to), max)]);
    setSolvencyOpen(true);
  };

  const confirmTranslateAll = () => {
    setSolvencyOpen(false);
    askJobNotificationPermission();
    void book.translateAll(runRange[0], runRange[1]);
  };

  // Progress across the book: pages translated, and review pairs marked reviewed.
  const progress = useMemo(() => {
    let translatedPages = 0;
    let pairs = 0;
    let reviewedPairs = 0;
    for (const page of book.pages) {
      if (!page.translationText.trim()) continue;
      translatedPages += 1;
      const count = pairParagraphs(page.sourceText, page.translationText).pairs.length;
      pairs += count;
      reviewedPairs += (page.reviewed ?? []).filter((i) => i < count).length;
    }
    return { translatedPages, pairs, reviewedPairs };
  }, [book.pages]);

  const pageLabel = t("translate.page", "صفحہ");
  const exportHtml = (mode: BookExportMode) => buildBookHtml(book.pages, mode, { pageLabel });

  const handleExportWord = async (mode: BookExportMode) => {
    const { exportDoc } = await import("@/lib/editor/exporters");
    const suffix = mode === "bilingual" ? t("translate.bilingual_suffix", "دو لسانی") : t("translate.translation_suffix", "ترجمہ");
    await exportDoc(exportHtml(mode), `${book.title || t("translate.book_title_placeholder", "کتاب کا ترجمہ")} — ${suffix}`);
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(book.getFullTranslation());
    toast.success(t("editor.copied", "Copied to clipboard"));
  };

  const handleOpenInEditor = (mode: BookExportMode) => {
    const html = exportHtml(mode);
    if (workspaceCtx) {
      workspaceCtx.insertIntoCanvas(html);
      toast.success(t("toast.canvas.inserted", "Inserted into Canvas"));
    } else {
      navigate(editorRoute(), { state: { content: html, source: "manual", projectId: folderId ?? undefined } });
    }
  };

  const formatDuration = (seconds: number) =>
    seconds < 90
      ? t("translate.about_seconds", "تقریباً {n} سیکنڈ").replace("{n}", String(Math.max(1, Math.round(seconds))))
      : t("translate.about_minutes", "تقریباً {n} منٹ").replace("{n}", String(Math.round(seconds / 60)));

  const readerPage: ReaderPage | null =
    currentBookPage?.sourceHtml && (shamelaBookId ?? book.resumedShamelaBookId)
      ? { bookId: (shamelaBookId ?? book.resumedShamelaBookId)!, pageNumber: currentBookPage.pageNum, text: currentBookPage.sourceHtml }
      : null;

  return (
    <div className="flex flex-col h-dvh bg-background">
      <header className="flex flex-wrap items-center gap-2 px-3 h-auto min-h-12 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Languages className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm font-medium truncate">
            {book.title || t("translate.book_title_placeholder", "کتاب کا ترجمہ")}
          </p>
        </div>

        {hasSource && (
          <>
            <div role="group" aria-label={t("translate.view", "منظر")} className="flex items-center rounded-md border border-border p-0.5">
              <Button
                variant={view === "review" ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5 text-xs"
                aria-pressed={view === "review"} onClick={() => setView("review")}
              >
                <Rows3 className="h-3.5 w-3.5" aria-hidden="true" />
                {t("translate.view_review", "جائزہ")}
              </Button>
              <Button
                variant={view === "page" ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5 text-xs"
                aria-pressed={view === "page"} onClick={() => setView("page")}
              >
                <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t("translate.view_page", "صفحہ")}
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={progress.translatedPages === 0}>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("translate.export", "نتیجہ")}
                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="text-xs">{t("translate.export_word", "Word فائل")}</DropdownMenuLabel>
                <DropdownMenuItem className="gap-2" onSelect={() => void handleExportWord("translation")}>
                  <FileText className="h-4 w-4" aria-hidden="true" />{t("translate.export_translation_only", "صرف ترجمہ")}
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onSelect={() => void handleExportWord("bilingual")}>
                  <Columns2 className="h-4 w-4" aria-hidden="true" />{t("translate.export_bilingual", "دو لسانی (اصل + ترجمہ)")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">{t("translate.open_in_editor", "ایڈیٹر میں کھولیں")}</DropdownMenuLabel>
                <DropdownMenuItem className="gap-2" onSelect={() => handleOpenInEditor("translation")}>
                  <FileEdit className="h-4 w-4" aria-hidden="true" />{t("translate.export_translation_only", "صرف ترجمہ")}
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onSelect={() => handleOpenInEditor("bilingual")}>
                  <FileEdit className="h-4 w-4" aria-hidden="true" />{t("translate.export_bilingual", "دو لسانی (اصل + ترجمہ)")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2" onSelect={handleCopyAll}>
                  <Copy className="h-4 w-4" aria-hidden="true" />{t("translate.copy_all", "سب کاپی کریں")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </header>

      {hasSource && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 py-2 sm:flex-wrap [&>*]:shrink-0">
          <Select value={book.sourceLanguage} onValueChange={book.setSourceLanguage}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("translate.source_language", "اصل زبان")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOURCE_LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
          <Select value={book.targetLanguage} onValueChange={book.setTargetLanguage}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("translate.target_language", "ترجمے کی زبان")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={book.genre} onValueChange={book.setGenre}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("translate.genre", "فن")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(GENRE_TRANSLATION_PROMPTS).map(([key, g]) => (
                <SelectItem key={key} value={key}>{g.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={book.style} onValueChange={(v) => book.setStyle(v as TranslationStyle)}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("translate.style", "انداز")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="idiomatic">{t("translate.style_idiomatic", "بامحاورہ")}</SelectItem>
              <SelectItem value="literal">{t("translate.style_literal", "لفظی")}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setGlossaryOpen(true)}>
            <BookMarked className="h-3.5 w-3.5" aria-hidden="true" />
            {t("translate.glossary", "اصطلاحات")}
            {book.glossary.length > 0 && <span className="tabular-nums text-muted-foreground">({book.glossary.length})</span>}
          </Button>

          {isBook && (
            <div className="ms-auto flex items-center gap-2 sm:flex-wrap">
              {book.totalPages > 1 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>{t("translate.pages_from", "صفحات")}</span>
                  <Input
                    type="number" inputMode="numeric" min={1} max={book.totalPages}
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(Number(e.target.value) || 1)}
                    className="h-8 w-16 text-center text-xs tabular-nums"
                    aria-label={t("translate.range_from", "پہلا صفحہ")}
                  />
                  <span>{t("translate.pages_to", "تا")}</span>
                  <Input
                    type="number" inputMode="numeric" min={1} max={book.totalPages}
                    value={rangeTo}
                    onChange={(e) => setRangeTo(Number(e.target.value) || 1)}
                    className="h-8 w-16 text-center text-xs tabular-nums"
                    aria-label={t("translate.range_to", "آخری صفحہ")}
                  />
                </div>
              )}
              {book.totalPages > SAMPLE_PAGES && progress.translatedPages === 0 && (
                <Button
                  variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
                  disabled={!!book.batch || !!book.backgroundRun || book.pages.length === 0}
                  onClick={() => openRun(1, SAMPLE_PAGES)}
                >
                  <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("translate.sample", "نمونہ: پہلے {n} صفحے").replace("{n}", String(SAMPLE_PAGES))}
                </Button>
              )}
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={!!book.batch || !!book.backgroundRun || book.pages.length === 0}
                onClick={() => openRun(rangeFrom, rangeTo)}
              >
                <Languages className="h-3.5 w-3.5" aria-hidden="true" />
                {rangeFrom === 1 && rangeTo >= book.totalPages
                  ? t("translate.translate_all", "پورا ترجمہ کریں")
                  : t("translate.translate_range", "یہ صفحات ترجمہ کریں")}
              </Button>
            </div>
          )}
        </div>
      )}

      {hasSource && book.pages.length > 1 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {t("translate.progress_translated", "ترجمہ: {done} از {total} صفحات")
              .replace("{done}", String(progress.translatedPages)).replace("{total}", String(book.totalPages || book.pages.length))}
          </span>
          <Progress
            value={progress.translatedPages ? (progress.reviewedPairs / Math.max(1, progress.pairs)) * 100 : 0}
            className="h-1.5 max-w-40 flex-1"
            aria-label={t("translate.progress_review_label", "جائزے کی پیش رفت")}
          />
          <span className="tabular-nums">
            {t("translate.progress_reviewed", "جائزہ: {done} از {total} پیراگراف")
              .replace("{done}", String(progress.reviewedPairs)).replace("{total}", String(progress.pairs))}
          </span>
        </div>
      )}

      {!hasSource ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          {needsPdfReupload ? (
            <>
              <FileText className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{t("translate.reupload_title", "جاری رکھنے کے لیے وہی PDF دوبارہ اپلوڈ کریں")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("translate.reupload_desc", "پہلے سے ترجمہ شدہ صفحات دوبارہ ترجمہ نہیں کیے جائیں گے۔")}</p>
              </div>
              <input
                ref={reuploadInputRef}
                type="file" accept="application/pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void book.loadPdf(f); e.target.value = ""; }}
              />
              <Button className="gap-2" onClick={() => reuploadInputRef.current?.click()}>
                <Upload className="h-4 w-4" />{t("translate.upload_pdf", "Upload PDF")}
              </Button>
            </>
          ) : needsFreshStart ? (
            <>
              <Languages className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">{t("translate.resume_unavailable", "یہ ترجمہ دوبارہ نہیں کھولا جا سکتا")}</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                {t("translate.resume_unavailable_desc", "متن یا تصویر کے ترجمے فوری مکمل ہو جاتے ہیں، اس لیے انہیں محفوظ کر کے دوبارہ کھولنے کی سہولت نہیں — نیا ترجمہ شروع کریں۔")}
              </p>
              <Button className="gap-2" onClick={() => navigate("/translate-book")}>
                <Languages className="h-4 w-4" />{t("translate.start_new", "نیا ترجمہ شروع کریں")}
              </Button>
            </>
          ) : showTextInput ? (
            <div className="w-full max-w-xl space-y-3">
              <Textarea
                autoFocus
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                dir={isRtlText(pastedText) ? "rtl" : "ltr"}
                className="min-h-[200px] text-sm resize-none text-start"
                placeholder={t("translate.text_placeholder", "Enter text to translate...")}
              />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setShowTextInput(false)}>
                  {t("common.back", "واپس")}
                </Button>
                <Button
                  className="flex-1 gap-2"
                  disabled={!pastedText.trim()}
                  onClick={() => void book.loadText(pastedText)}
                >
                  <Languages className="h-4 w-4" />
                  {t("translate.start_translation", "Translate")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Languages className="h-10 w-10 text-primary" />
              <p className="text-sm text-muted-foreground max-w-sm">
                {t("translate.book_source_hint", "متن پیسٹ کریں، تصویر یا PDF اپلوڈ کریں، یا مکتبہ شاملہ سے کوئی کتاب منتخب کریں۔")}
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button variant="outline" className="gap-2 h-24 w-32 flex-col" onClick={() => setShowTextInput(true)}>
                  <Type className="h-6 w-6" />{t("translate.input_text", "متن")}
                </Button>
                <input
                  ref={imageInputRef}
                  type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void book.loadImage(f); e.target.value = ""; }}
                />
                <Button variant="outline" className="gap-2 h-24 w-32 flex-col" onClick={() => imageInputRef.current?.click()}>
                  <ImageIcon className="h-6 w-6" />{t("translate.input_image", "تصویر")}
                </Button>
                <input
                  ref={uploadInputRef}
                  type="file" accept="application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void book.loadPdf(f); e.target.value = ""; }}
                />
                <Button variant="outline" className="gap-2 h-24 w-32 flex-col" onClick={() => uploadInputRef.current?.click()}>
                  <Upload className="h-6 w-6" />{t("translate.input_pdf", "PDF")}
                </Button>
                <Button variant="outline" className="gap-2 h-24 w-32 flex-col" onClick={() => setPickerOpen(true)}>
                  <Library className="h-6 w-6" />
                  {t("translate.pick_shamela_book_short", "مکتبہ شاملہ")}
                </Button>
              </div>
            </>
          )}
          {book.sourceError && <p className="text-xs text-destructive max-w-sm">{book.sourceError}</p>}
        </div>
      ) : view === "review" ? (
        <div className="flex-1 min-h-0">
          <ReviewPane
            page={currentBookPage}
            currentPage={book.currentPage}
            totalPages={book.totalPages}
            onPageChange={book.setCurrentPage}
            glossary={book.glossary}
            streamingText={book.streamingText}
            busy={!!book.batch || !!book.backgroundRun || book.isTranslatingSingle}
            retranslatingIndex={book.retranslating?.pageNum === book.currentPage ? book.retranslating.index : null}
            onTranslatePage={() => void book.translateSinglePage(book.currentPage)}
            onUpdateParagraph={(i, text) => book.updateParagraph(book.currentPage, i, text)}
            onToggleReviewed={(i) => book.toggleReviewed(book.currentPage, i)}
            onSetPageReviewed={(all) => book.setPageReviewed(book.currentPage, all)}
            onRetranslate={(i, request) => book.retranslateParagraph(book.currentPage, i, request)}
          />
        </div>
      ) : (
        <ResizablePanelGroup direction={isMobile ? "vertical" : "horizontal"} className="flex-1 min-h-0">
          <ResizablePanel defaultSize={50} minSize={25}>
            {book.sourceKind === "pdf" || book.sourceKind === "image" ? (
              <BookPageViewer
                pages={book.pages}
                currentPage={book.currentPage}
                totalPages={book.totalPages}
                loadedCount={book.loadedCount}
                isLoadingSource={book.isLoadingSource}
                onPageChange={book.setCurrentPage}
              />
            ) : book.sourceKind === "shamela" ? (
              <div className="h-full overflow-auto">
                <ReaderContent
                  page={readerPage}
                  loading={book.isLoadingSource}
                  error={book.sourceError}
                  pageNumber={book.currentPage}
                  pageCount={book.totalPages}
                  reader={null}
                />
              </div>
            ) : (
              <div className="h-full overflow-auto p-6">
                <p
                  dir={isRtlText(currentBookPage?.sourceText ?? "") ? "rtl" : "ltr"}
                  className="text-sm leading-relaxed whitespace-pre-wrap text-start"
                >
                  {currentBookPage?.sourceText}
                </p>
              </div>
            )}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={25}>
            <TranslationOutput
              translationText={currentBookPage?.translationText ?? ""}
              streamingText={book.streamingText}
              isTranslating={book.isTranslatingSingle}
              onTranslateAi={() => void book.translateSinglePage(book.currentPage)}
              onUpdateText={(text) => book.updateTranslation(book.currentPage, text)}
              onVoiceResult={() => {}}
              t={t}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {book.batch && <ChunkProgressBar progress={book.batch} onCancel={book.cancelBatch} />}
      {!book.batch && book.backgroundRun && (
        <ChunkProgressBar
          progress={{
            phase: "running", current: book.backgroundRun.current, total: book.backgroundRun.total,
            done: book.backgroundRun.current, failed: 0, skipped: 0, tokensSpent: 0, throttled: false,
          }}
          onCancel={() => cancelJob(book.backgroundRun!.id)}
        />
      )}

      <SolvencyDialog
        open={solvencyOpen}
        onOpenChange={setSolvencyOpen}
        taskLabel={t("translate.run_label", "صفحات {from} تا {to} کا ترجمہ")
          .replace("{from}", String(runRange[0])).replace("{to}", String(runRange[1]))}
        totalChunks={estimate.pages}
        totalCost={estimate.tokenCost}
        availableTokens={tokenBalance.total}
        onConfirm={confirmTranslateAll}
        extraRows={[
          ...(estimate.pagesToRead
            ? [{ label: t("translate.pages_to_read", "پہلے پڑھے جانے والے صفحات:"), value: String(estimate.pagesToRead) }]
            : []),
          { label: t("translate.estimated_time", "اندازاً وقت:"), value: formatDuration(estimate.estimatedSeconds) },
        ]}
      />

      <GlossaryDialog
        open={glossaryOpen}
        onOpenChange={setGlossaryOpen}
        glossary={book.glossary}
        onSave={book.setGlossary}
        projectId={book.projectId}
      />

      <ShamelaBookPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(bookId, bookTitle) => {
          setShamelaBookId(bookId);
          void book.loadShamelaBook(bookId, bookTitle);
        }}
      />
    </div>
  );
}
