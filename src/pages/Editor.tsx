import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  FileText, Download, Copy, ArrowLeft, ChevronDown, FileType, FileCode, File,
  History, CheckCircle2, Loader2, AlertCircle, BookmarkPlus, RotateCcw, AudioLines, X
} from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import RichEditor, { type DocChangePayload } from "@/components/editor/RichEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSeo } from "@/hooks/useSeo";
import { useDocument } from "@/core/workspace/useDocument";
import { documentService } from "@/core/workspace/documentService";
import { htmlToTiptapJSON } from "@/core/workspace/bookSectionMigration";
import { exportTxt, exportHtml, exportDoc, exportPdf, stripSuggestions } from "@/lib/editor/exporters";
import { splitChaptersFromHtml } from "@/lib/audiobook/splitChapters";
import { isDesktop } from "@/utils/environment";
import type { AudiobookExportProgress } from "@/core/voice/types";

interface EditorLocationState {
  content?: string;
  source?: "research" | "ocr" | "transcribe" | "manual" | "extract";
}

const Editor = () => {
  const { t, direction } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const { documentId } = useParams<{ documentId?: string }>();
  const state = (location.state as EditorLocationState) ?? {};

  // When the workspace shell is on, this page is only a redirect stub — the
  // handoff state travels with it and is consumed by /workspace.
  const redirectsToWorkspace = import.meta.env.VITE_WORKSPACE_SHELL !== "false";

  useEffect(() => {
    if (redirectsToWorkspace) {
      navigate(documentId ? `/workspace/${documentId}` : "/workspace", { replace: true, state });
    }
  }, [documentId, navigate, state, redirectsToWorkspace]);

  useSeo({ title: "Editor — Easy Editor", description: "Rich text editor for editing transcriptions, OCR results, and research output.", path: "/editor", noindex: true });

  const {
    doc,
    loading: docLoading,
    saveStatus,
    versions,
    updateTitle: syncDocTitle,
    updateContent: syncDocContent,
    createSnapshot,
  } = useDocument(documentId);

  const [title, setTitle] = useState<string>("");
  const [currentText, setCurrentText] = useState("");
  const [currentHtml, setCurrentHtml] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [restoredContent, setRestoredContent] = useState<Record<string, unknown> | null>(null);
  const [contentRevision, setContentRevision] = useState(0);

  // Sync title when document loads
  useEffect(() => {
    if (doc) {
      setTitle(doc.title);
    } else if (!documentId) {
      if (state.source === "research") setTitle(t("editor.from_research"));
      else if (state.source === "ocr") setTitle(t("editor.from_ocr"));
      else if (state.source === "transcribe") setTitle(t("editor.from_transcribe"));
      else if (state.source === "extract") setTitle(t("editor.from_extract"));
      else setTitle(t("editor.untitled"));
    }
  }, [doc, documentId, state.source, t]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (documentId) {
      syncDocTitle(val);
    }
  };

  const handleEditorChange = useCallback((html: string, text: string) => {
    setCurrentHtml(html);
    setCurrentText(text);
  }, []);

  const handleDocChange = useCallback(({ json, text, html }: DocChangePayload) => {
    setCurrentHtml(html);
    setCurrentText(text);
    if (documentId) {
      syncDocContent(json);
    }
  }, [documentId, syncDocContent]);

  // Landing on /editor without an id: resolve a real document and redirect, so
  // anything typed here is persisted like everywhere else. Content handed over
  // from Research/OCR/Transcribe is carried into that document rather than left
  // in router state, where a refresh would drop it.
  const autoResolveStarted = useRef(false);
  useEffect(() => {
    // Don't race the workspace redirect: /workspace does its own resolve.
    if (redirectsToWorkspace || documentId || autoResolveStarted.current) return;
    autoResolveStarted.current = true;

    const resolveDocument = async () => {
      try {
        const projects = await documentService.listProjects();
        const proj = projects[0] ?? (await documentService.createProject("General Workspace", "general"));

        if (state.content) {
          const created = await documentService.createDocument(
            proj.id,
            title || t("editor.untitled"),
            htmlToTiptapJSON(state.content),
          );
          navigate(`/editor/${created.id}`, { replace: true });
          return;
        }

        // Reuse the last blank document instead of leaving a trail of them.
        const blank = await documentService.findBlankDocument(proj.id);
        const target = blank ?? (await documentService.createDocument(proj.id, t("editor.untitled")));
        navigate(`/editor/${target.id}`, { replace: true });
      } catch (err) {
        console.error("[Editor] Could not resolve a document for /editor:", err);
        autoResolveStarted.current = false;
        toast.error(t("editor.ai_error"));
      }
    };

    resolveDocument();
  }, [documentId, state.content, navigate, title, t, redirectsToWorkspace]);

  const handleRestoreVersion = (contentJson: Record<string, unknown>) => {
    // Both halves matter: `syncDocContent` queues the save, and bumping the
    // revision is what actually puts the old text back on screen — without it
    // the editor keeps showing the current draft and the next keystroke would
    // overwrite the restored version.
    setRestoredContent(contentJson);
    setContentRevision((n) => n + 1);
    syncDocContent(contentJson);
    toast.success("Restored version into editor");
    setHistoryOpen(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentText);
    toast.success(t("editor.copied"));
  };

  const handleCreateSnapshot = async () => {
    if (!documentId) return;
    const snap = await createSnapshot(snapshotLabel.trim() || undefined);
    if (snap) {
      toast.success("Snapshot version created");
      setSnapshotLabel("");
    }
  };

  // SPEC-M5 FR-6.9: whole document → .mp3 with chapter marks. Desktop only —
  // it runs on the local Piper voices in the main process.
  const [audiobookProgress, setAudiobookProgress] = useState<AudiobookExportProgress | null>(null);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.voice?.onAudiobookProgress) return;
    return window.electronAPI.voice.onAudiobookProgress(setAudiobookProgress);
  }, []);

  const handleAudiobookExport = async () => {
    const chapters = splitChaptersFromHtml(stripSuggestions(currentHtml));
    if (chapters.length === 0) {
      toast.error(t("editor.audiobook_empty") || "آڈیو بک کے لیے کوئی متن نہیں۔");
      return;
    }

    setAudiobookProgress({ phase: "synthesizing", currentChapter: 0, totalChapters: chapters.length });
    try {
      const result = await window.electronAPI!.voice!.exportAudiobook({
        chapters,
        lang: "ur-PK",
        title: title || t("editor.untitled"),
      });
      if (result.cancelled) {
        toast.info(t("editor.audiobook_cancelled") || "آڈیو بک ایکسپورٹ منسوخ ہو گئی۔");
        return;
      }
      const minutes = Math.round(result.durationMs / 60000);
      toast.success(
        (t("editor.audiobook_done") || "آڈیو بک تیار: {n} باب، تقریباً {m} منٹ")
          .replace("{n}", String(result.chapterCount))
          .replace("{m}", String(minutes)),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAudiobookProgress(null);
    }
  };

  const handleDownload = (format: "word" | "pdf" | "html" | "txt") => {
    switch (format) {
      case "word": exportDoc(currentHtml, title); break;
      case "pdf": exportPdf(currentHtml, title); break;
      case "html": exportHtml(currentHtml, title); break;
      case "txt": {
        const clean = stripSuggestions(currentHtml);
        const text = clean === currentHtml
          ? currentText
          : (new DOMParser().parseFromString(clean, "text/html").body.textContent ?? currentText);
        exportTxt(text, title);
        break;
      }
    }
    if (format !== "pdf") toast.success(t("editor.exported"));
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem-5rem)] md:h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
<Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)} aria-label="Go back">
  <ArrowLeft className="h-4 w-4" />
</Button>
          <FileText className="h-5 w-5 text-primary shrink-0" />

          {docLoading ? (
            <div className="h-6 w-32 bg-muted animate-pulse rounded" />
          ) : (
            <Input
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="h-8 text-base font-semibold border-0 bg-transparent shadow-none focus-visible:ring-0 px-1 max-w-md"
              placeholder={t("editor.untitled")}
            />
          )}

          {documentId && (
            <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground ml-2">
              {saveStatus === "saving" && (
                <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 bg-amber-500/5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving...
                </Badge>
              )}
              {saveStatus === "saved" && (
                <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600 bg-emerald-500/5">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  Saved
                </Badge>
              )}
              {saveStatus === "error" && (
                <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive bg-destructive/5">
                  <AlertCircle className="h-3 w-3" />
                  Save error
                </Badge>
              )}
            </div>
          )}

          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            {documentId && (
              <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                    <History className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Versions</span>
                    {versions.length > 0 && (
                      <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary">
                        {versions.length}
                      </span>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent side={direction === "rtl" ? "left" : "right"} className="w-80 sm:w-96">
                  <SheetHeader>
                    <SheetTitle className="text-base">Document Versions</SheetTitle>
                  </SheetHeader>
                  <div className="space-y-4 py-4">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Snapshot label (optional)"
                        value={snapshotLabel}
                        onChange={(e) => setSnapshotLabel(e.target.value)}
                        className="h-8 text-xs"
                      />
                      <Button size="sm" onClick={handleCreateSnapshot} className="h-8 gap-1 text-xs">
                        <BookmarkPlus className="h-3.5 w-3.5" />
                        Save
                      </Button>
                    </div>

                    <div className="divide-y divide-border border rounded-md max-h-[70vh] overflow-y-auto">
                      {versions.length === 0 ? (
                        <p className="p-4 text-xs text-muted-foreground text-center">
                          No saved versions yet. Save a snapshot anytime.
                        </p>
                      ) : (
                        versions.map((v) => (
                          <div key={v.id} className="p-3 text-xs space-y-1 flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-foreground">{v.label || "Snapshot"}</p>
                              <p className="text-muted-foreground text-[11px]">
                                {new Date(v.created_at).toLocaleString()}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px] gap-1 shrink-0"
                              onClick={() => handleRestoreVersion(v.content_json)}
                            >
                              <RotateCcw className="h-3 w-3" />
                              Restore
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            )}

            <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={handleCopy}>
              <Copy className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("editor.copy")}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs">
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("editor.download")}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleDownload("word")} className="cursor-pointer gap-2">
                  <FileType className="h-4 w-4" />
                  {t("editor.download_word")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("pdf")} className="cursor-pointer gap-2">
                  <File className="h-4 w-4" />
                  {t("editor.download_pdf")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("html")} className="cursor-pointer gap-2">
                  <FileCode className="h-4 w-4" />
                  {t("editor.download_html")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("txt")} className="cursor-pointer gap-2">
                  <FileText className="h-4 w-4" />
                  {t("editor.download_txt")}
                </DropdownMenuItem>
                {isDesktop() && (
                  <DropdownMenuItem
                    onClick={handleAudiobookExport}
                    disabled={audiobookProgress !== null}
                    className="cursor-pointer gap-2"
                  >
                    <AudioLines className="h-4 w-4" />
                    {t("editor.download_audiobook") || "آڈیو بک (.mp3)"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* FR-6.9: a book-length export runs for minutes, so it says where it is
            and offers a way out. */}
        {audiobookProgress && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/40 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span className="flex-1 truncate">
              {audiobookProgress.phase === "synthesizing"
                ? `${t("editor.audiobook_synthesizing") || "آواز بنائی جا رہی ہے"} — ${audiobookProgress.currentChapter ?? 0}/${audiobookProgress.totalChapters ?? 0}${audiobookProgress.chapterTitle ? `: ${audiobookProgress.chapterTitle}` : ""}`
                : audiobookProgress.phase === "encoding"
                ? `${t("editor.audiobook_encoding") || "MP3 میں تبدیل ہو رہا ہے"} — ${Math.round((audiobookProgress.encodeFraction ?? 0) * 100)}%`
                : t("editor.audiobook_writing") || "فائل محفوظ ہو رہی ہے"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs"
              onClick={() => window.electronAPI?.voice?.cancelAudiobook?.()}
            >
              <X className="h-3 w-3" />
              {t("common.cancel")}
            </Button>
          </div>
        )}

        {/* Editor Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto">
            {docLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <RichEditor
                initialContent={doc ? undefined : (state.content ?? "")}
                contentJson={restoredContent ?? doc?.content_json}
                contentRevision={contentRevision}
                placeholder={t("editor.placeholder")}
                onChange={handleEditorChange}
                onDocChange={handleDocChange}
              />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Editor;
