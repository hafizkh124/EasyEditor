import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Upload, FileText, Library, ArrowRightLeft, FileEdit, Copy, Languages, Type, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { isRtlText } from "@/utils/textUtils";
import { useLanguage } from "@/contexts/LanguageContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { editorRoute } from "@/lib/routes";
import { useBookTranslation } from "@/hooks/useBookTranslation";
import { takePendingBookFile } from "@/lib/translate/pendingBookFile";
import { GENRE_TRANSLATION_PROMPTS } from "@/lib/translationMemory";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { SolvencyDialog } from "@/components/workspace/SolvencyDialog";
import ChunkProgressBar from "@/components/workspace/ChunkProgressBar";
import BookPageViewer from "@/components/translate/BookPageViewer";
import TranslationOutput from "@/components/translate/TranslationOutput";
import { ShamelaBookPickerDialog } from "@/components/translate/ShamelaBookPickerDialog";
import { ReaderContent } from "@/components/shamela/ReaderContent";
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
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(1);
  const [showTextInput, setShowTextInput] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const reuploadInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const book = useBookTranslation({
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

  const currentBookPage = book.pages.find((p) => p.pageNum === book.currentPage);
  const hasSource = book.sourceKind !== null;
  const needsPdfReupload = !hasSource && !!book.projectId && !book.isLoadingSource;

  const estimate = book.estimateBatch(rangeFrom, rangeTo);

  const confirmTranslateAll = () => {
    setSolvencyOpen(false);
    void book.translateAll(rangeFrom, rangeTo);
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(book.getFullTranslation());
    toast.success(t("editor.copied", "Copied to clipboard"));
  };

  const handleInsertAll = () => {
    const full = book.getFullTranslation();
    const html = full.split("\n\n").map((block) => `<p>${block.replace(/\n/g, "<br/>")}</p>`).join("");
    if (workspaceCtx) {
      workspaceCtx.insertIntoCanvas(html);
      toast.success(t("toast.canvas.inserted", "Inserted into Canvas"));
    } else {
      navigate(editorRoute(), { state: { content: full, source: "manual" } });
    }
  };

  const readerPage: ReaderPage | null =
    currentBookPage?.sourceHtml && shamelaBookId
      ? { bookId: shamelaBookId, pageNumber: currentBookPage.pageNum, text: currentBookPage.sourceHtml }
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
            <Select value={book.sourceLanguage} onValueChange={book.setSourceLanguage}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCE_LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Select value={book.targetLanguage} onValueChange={book.setTargetLanguage}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={book.genre} onValueChange={book.setGenre}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(GENRE_TRANSLATION_PROMPTS).map(([key, g]) => (
                  <SelectItem key={key} value={key}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleCopyAll}>
              <Copy className="h-3.5 w-3.5" />
              {t("translate.copy_all", "سب کاپی کریں")}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleInsertAll}>
              <FileEdit className="h-3.5 w-3.5" />
              {t("translate.insert_all", "کینوس میں شامل کریں")}
            </Button>
            {(book.sourceKind === "pdf" || book.sourceKind === "shamela") && (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={!!book.batch || book.pages.length === 0}
                onClick={() => setSolvencyOpen(true)}
              >
                <Languages className="h-3.5 w-3.5" />
                {t("translate.translate_all", "پورا ترجمہ کریں")}
              </Button>
            )}
          </>
        )}
      </header>

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

      <SolvencyDialog
        open={solvencyOpen}
        onOpenChange={setSolvencyOpen}
        taskLabel={t("translate.translate_all", "پورا ترجمہ کریں")}
        totalChunks={estimate.pages}
        totalCost={estimate.tokenCost}
        availableTokens={tokenBalance.total}
        onConfirm={confirmTranslateAll}
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
