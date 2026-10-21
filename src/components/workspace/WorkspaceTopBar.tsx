import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText, Download, CheckCircle2, Loader2, AlertCircle,
  ChevronDown, FileType, FileCode, File, Search, PanelRight, PanelLeft,
  Languages, MoreHorizontal, ArrowLeft, History, AudioLines, X, Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { VersionHistorySheet } from "./VersionHistorySheet";
import { exportTxt, exportHtml, exportDoc, exportPdf, stripSuggestions } from "@/lib/editor/exporters";
import { splitChaptersFromHtml } from "@/lib/audiobook/splitChapters";
import { isDesktop, modifierKeyLabel } from "@/utils/environment";
import { WorkspaceAppMenu } from "./WorkspaceAppMenu";
import { DesktopAccountMenu } from "@/components/auth/DesktopAccountMenu";
import { WordExportDialog } from "@/components/editor/WordExportDialog";
import type { Document, DocumentVersion } from "@/core/workspace/types";
import type { AudiobookExportProgress } from "@/core/voice/types";

interface WorkspaceTopBarProps {
  doc: Document | null;
  projectName?: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
  versions: DocumentVersion[];
  currentText: string;
  currentHtml: string;
  onTitleChange: (newTitle: string) => void;
  onRestoreVersion: (contentJson: Record<string, unknown>) => void;
  onCreateSnapshot: (label?: string) => Promise<unknown>;
}

export const WorkspaceTopBar: React.FC<WorkspaceTopBarProps> = ({
  doc,
  projectName,
  saveStatus,
  versions,
  currentText,
  currentHtml,
  onTitleChange,
  onRestoreVersion,
  onCreateSnapshot,
}) => {
  const { t, language, setLanguage, direction } = useLanguage();
  const navigate = useNavigate();
  const { workbenchCollapsed, toggleWorkbench, setCommandPaletteOpen, mobileLibraryOpen, setMobileLibraryOpen } =
    useWorkspace();
  // The Versions trigger button is `hidden sm:flex` — controlled state gives the
  // mobile overflow menu a second way in without duplicating the sheet.
  const [versionsOpen, setVersionsOpen] = useState(false);

  // SPEC-M5 FR-6.9: whole document → .mp3 with chapter marks. Desktop only —
  // it runs on the local Piper voices in the main process. Ported from the
  // /editor page stub, which was the only place this UI existed (UX-v1 P3).
  const [audiobookProgress, setAudiobookProgress] = useState<AudiobookExportProgress | null>(null);
  const [wordExportOpen, setWordExportOpen] = useState(false);
  const canWordExport = isDesktop() && Boolean(typeof window !== "undefined" && window.electronAPI?.docBridge);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.voice?.onAudiobookProgress) return;
    return window.electronAPI.voice.onAudiobookProgress(setAudiobookProgress);
  }, []);

  const handleAudiobookExport = async () => {
    const title = doc?.title || t("editor.untitled");
    const chapters = splitChaptersFromHtml(stripSuggestions(currentHtml));
    if (chapters.length === 0) {
      toast.error(t("editor.audiobook_empty", "There is no text to turn into an audiobook."));
      return;
    }

    setAudiobookProgress({ phase: "synthesizing", currentChapter: 0, totalChapters: chapters.length });
    try {
      const result = await window.electronAPI!.voice!.exportAudiobook({
        chapters,
        lang: "ur-PK",
        title,
      });
      if (result.cancelled) {
        toast.info(t("editor.audiobook_cancelled", "Audiobook export was cancelled."));
        return;
      }
      const minutes = Math.round(result.durationMs / 60000);
      toast.success(formatTranslation(t("toast.editor.audiobook_ready"), {
        chapters: result.chapterCount,
        minutes,
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAudiobookProgress(null);
    }
  };

  const handleDownload = async (format: "word" | "pdf" | "html" | "txt") => {
    const title = doc?.title || t("editor.untitled");
    switch (format) {
      case "word": await exportDoc(currentHtml, title); break;
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
    if (format !== "pdf") toast.success(t("editor.exported", "Exported"));
  };

  const toggleDirection = () => {
    const nextLang = language === "ur" ? "en" : "ur";
    setLanguage(nextLang);
  };

  return (
    <>
    <header className="app-topbar app-topbar-drag flex h-14 items-center justify-between border-b border-border bg-background/95 backdrop-blur px-3 md:px-4 z-20 shrink-0">
      {/* Left: Breadcrumbs & Title */}
      <div className="flex items-center gap-2 min-w-0 flex-1 max-w-xl">
        {/* The workspace has no sidebar (FR-1.4), so this is the only route
            back to the dashboard, the tools and the profile. */}
        <WorkspaceAppMenu />
        <Button variant="ghost" size="icon" className="h-8 w-8 min-h-touch min-w-touch shrink-0 md:hidden" onClick={() => navigate(-1)} aria-label={t("common.go_back", "Go back")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {/* Library drawer toggle — mobile only (FR-8.2) */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 min-h-touch min-w-touch shrink-0 md:hidden"
          onClick={() => setMobileLibraryOpen(!mobileLibraryOpen)}
          aria-expanded={mobileLibraryOpen}
          aria-label={t("nav.library", "Library")}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
        <FileText className="hidden md:block h-4 w-4 text-primary shrink-0" />
        
        {projectName && (
          <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[120px]">
            {projectName} <span className="mx-1">›</span>
          </span>
        )}

        <Input
          value={doc?.title ?? ""}
          onChange={(e) => onTitleChange(e.target.value)}
          className="h-8 text-sm md:text-base font-semibold border-0 bg-transparent shadow-none focus-visible:ring-1 focus-visible:ring-ring px-1.5 min-w-[140px] truncate"
          placeholder={t("editor.untitled", "Untitled")}
        />
      </div>

      {/* Center: Save status badges */}
      <div className="hidden md:flex items-center gap-2">
        {saveStatus === "saving" && (
          <Badge variant="outline" className="gap-1 text-xs border-warning/40 text-warning bg-warning/5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{t("common.saving", "Saving...")}</span>
          </Badge>
        )}
        {saveStatus === "saved" && (
          <Badge variant="outline" className="gap-1 text-xs border-success/40 text-success bg-success/5">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            <span>{t("common.saved", "Saved")}</span>
          </Badge>
        )}
        {saveStatus === "error" && (
          <Badge variant="outline" className="gap-1 text-xs border-destructive/40 text-destructive bg-destructive/5">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{t("common.save_error", "Save error")}</span>
          </Badge>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Spotlight Command Palette trigger */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCommandPaletteOpen(true)}
          className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground hidden sm:flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span>{t("common.search", "Search")}</span>
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground opacity-100">
            {`${modifierKeyLabel()}K`}
          </kbd>
        </Button>

        {doc?.id && (
          <VersionHistorySheet
            versions={versions}
            side={direction === "rtl" ? "left" : "right"}
            onRestoreVersion={onRestoreVersion}
            onCreateSnapshot={onCreateSnapshot}
            open={versionsOpen}
            onOpenChange={setVersionsOpen}
          />
        )}

        {/* Export dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 px-2 hidden sm:flex">
              <Download className="h-3.5 w-3.5" />
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleDownload("word")} className="cursor-pointer gap-2">
              <FileType className="h-4 w-4" />
              {t("editor.download_word", "Word (.docx)")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownload("pdf")} className="cursor-pointer gap-2">
              <File className="h-4 w-4" />
              {t("editor.download_pdf", "PDF")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownload("html")} className="cursor-pointer gap-2">
              <FileCode className="h-4 w-4" />
              {t("editor.download_html", "HTML")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownload("txt")} className="cursor-pointer gap-2">
              <FileText className="h-4 w-4" />
              {t("editor.download_txt", "Text (.txt)")}
            </DropdownMenuItem>
            {canWordExport && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setWordExportOpen(true)} className="cursor-pointer gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {t("docbridge.export.menu_item", "Through Word (high fidelity)")}
                </DropdownMenuItem>
              </>
            )}
            {isDesktop() && (
              <DropdownMenuItem
                onClick={handleAudiobookExport}
                disabled={audiobookProgress !== null}
                className="cursor-pointer gap-2"
              >
                <AudioLines className="h-4 w-4" />
                {t("editor.download_audiobook", "آڈیو بک (.mp3)")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Optional online account sign-in (desktop only) */}
        <DesktopAccountMenu />

        {/* Language / RTL toggle */}
        <Button variant="ghost" size="icon" className="h-8 w-8 min-h-touch min-w-touch md:min-h-0 md:min-w-0 text-xs" aria-label={t("common.switch_language", "Switch Language / RTL")} onClick={toggleDirection}>
          <Languages className="h-4 w-4" />
        </Button>

        {/* Workbench Toggle — icon-only (QA finding: the label was redundant
            noise next to a self-explanatory panel-toggle glyph; the icon
            state (filled vs outline) already shows open/closed). */}
        <Button
          variant={workbenchCollapsed ? "outline" : "default"}
          size="icon"
          onClick={toggleWorkbench}
          className="h-8 w-8 min-h-touch min-w-touch md:min-h-0 md:min-w-0 shrink-0"
          title={t("workbench.toggle", "Toggle Workbench")}
          aria-label={t("workbench.toggle", "Toggle Workbench")}
        >
          <PanelRight className="h-4 w-4" />
        </Button>

        {/* Mobile Overflow Menu (360px) */}
        <div className="sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 min-h-touch min-w-touch" aria-label={t("common.more_options", "More options")}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setCommandPaletteOpen(true)} className="gap-2">
                <Search className="h-4 w-4" /> {t("common.search", "Search")} {`(${modifierKeyLabel()}K)`}
              </DropdownMenuItem>
              {doc?.id && (
                <DropdownMenuItem onClick={() => setVersionsOpen(true)} className="gap-2">
                  <History className="h-4 w-4" /> {t("library.versions", "Versions")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleDownload("word")} className="gap-2">
                <FileType className="h-4 w-4" /> {t("editor.download_word_action", "Download Word")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload("pdf")} className="gap-2">
                <File className="h-4 w-4" /> {t("editor.download_pdf_action", "Download PDF")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload("html")} className="gap-2">
                <FileCode className="h-4 w-4" /> {t("editor.download_html_action", "Download HTML")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload("txt")} className="gap-2">
                <FileText className="h-4 w-4" /> {t("editor.download_txt_action", "Download Text")}
              </DropdownMenuItem>
              {isDesktop() && (
                <DropdownMenuItem
                  onClick={handleAudiobookExport}
                  disabled={audiobookProgress !== null}
                  className="gap-2"
                >
                  <AudioLines className="h-4 w-4" /> {t("editor.download_audiobook", "آڈیو بک (.mp3)")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>

    {/* FR-6.9: a book-length export runs for minutes, so it says where it is
        and offers a way out. */}
    {audiobookProgress && (
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted text-xs shrink-0">
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        <span className="flex-1 truncate">
          {audiobookProgress.phase === "synthesizing"
            ? `${t("editor.audiobook_synthesizing", "آواز بنائی جا رہی ہے")} — ${audiobookProgress.currentChapter ?? 0}/${audiobookProgress.totalChapters ?? 0}${audiobookProgress.chapterTitle ? `: ${audiobookProgress.chapterTitle}` : ""}`
            : audiobookProgress.phase === "encoding"
            ? `${t("editor.audiobook_encoding", "MP3 میں تبدیل ہو رہا ہے")} — ${Math.round((audiobookProgress.encodeFraction ?? 0) * 100)}%`
            : t("editor.audiobook_writing", "فائل محفوظ ہو رہی ہے")}
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

    {canWordExport && (
      <WordExportDialog
        open={wordExportOpen}
        onOpenChange={setWordExportOpen}
        html={stripSuggestions(currentHtml)}
        title={doc?.title || t("editor.untitled", "Untitled")}
      />
    )}
    </>
  );
};
