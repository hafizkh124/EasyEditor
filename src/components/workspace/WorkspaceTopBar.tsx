import React from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText, Download, Copy, CheckCircle2, Loader2, AlertCircle,
  ChevronDown, FileType, FileCode, File, Search, PanelRight, PanelLeft,
  Languages, MoreHorizontal, ArrowLeft
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { VersionHistorySheet } from "./VersionHistorySheet";
import { exportTxt, exportHtml, exportDoc, exportPdf, stripSuggestions } from "@/lib/editor/exporters";
import AppVersionBadge from "@/components/AppVersionBadge";
import { WorkspaceAppMenu } from "./WorkspaceAppMenu";
import { DesktopAccountMenu } from "@/components/auth/DesktopAccountMenu";
import type { Document, DocumentVersion } from "@/core/workspace/types";

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

  const handleCopy = () => {
    navigator.clipboard.writeText(currentText);
    toast.success(t("editor.copied") || "Copied to clipboard");
  };

  const handleDownload = (format: "word" | "pdf" | "html" | "txt") => {
    const title = doc?.title || t("editor.untitled");
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

  const toggleDirection = () => {
    const nextLang = language === "ur" ? "en" : "ur";
    setLanguage(nextLang);
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background/95 backdrop-blur px-3 md:px-4 z-20 shrink-0">
      {/* Left: Breadcrumbs & Title */}
      <div className="flex items-center gap-2 min-w-0 flex-1 max-w-xl">
        {/* The workspace has no sidebar (FR-1.4), so this is the only route
            back to the dashboard, the tools and the profile. */}
        <WorkspaceAppMenu />
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 md:hidden" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {/* Library drawer toggle — mobile only (FR-8.2) */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 md:hidden"
          onClick={() => setMobileLibraryOpen(!mobileLibraryOpen)}
          aria-expanded={mobileLibraryOpen}
          aria-label={t("nav.library") || "Library"}
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
          placeholder={t("editor.untitled")}
        />
      </div>

      {/* Center: Save status badges */}
      <div className="hidden md:flex items-center gap-2">
        {saveStatus === "saving" && (
          <Badge variant="outline" className="gap-1 text-xs border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Saving...</span>
          </Badge>
        )}
        {saveStatus === "saved" && (
          <Badge variant="outline" className="gap-1 text-xs border-emerald-500/40 text-emerald-600 bg-emerald-500/5">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            <span>Saved</span>
          </Badge>
        )}
        {saveStatus === "error" && (
          <Badge variant="outline" className="gap-1 text-xs border-destructive/40 text-destructive bg-destructive/5">
            <AlertCircle className="h-3 w-3" />
            <span>Save error</span>
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
          <span>Search</span>
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground opacity-100">
            <span className="text-xs">⌘</span>K
          </kbd>
        </Button>

        {doc?.id && (
          <VersionHistorySheet
            versions={versions}
            side={direction === "rtl" ? "left" : "right"}
            onRestoreVersion={onRestoreVersion}
            onCreateSnapshot={onCreateSnapshot}
          />
        )}

        {/* Copy */}
        <Button variant="ghost" size="icon" className="h-8 w-8 hidden sm:flex" aria-label="Copy text" onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" />
        </Button>

        {/* Export dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 px-2 hidden sm:flex">
              <Download className="h-3.5 w-3.5" />
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleDownload("word")} className="cursor-pointer gap-2">
              <FileType className="h-4 w-4" />
              {t("editor.download_word") || "Word (.docx)"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownload("pdf")} className="cursor-pointer gap-2">
              <File className="h-4 w-4" />
              {t("editor.download_pdf") || "PDF"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownload("html")} className="cursor-pointer gap-2">
              <FileCode className="h-4 w-4" />
              {t("editor.download_html") || "HTML"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownload("txt")} className="cursor-pointer gap-2">
              <FileText className="h-4 w-4" />
              {t("editor.download_txt") || "Text (.txt)"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Optional online account sign-in (desktop only) */}
        <DesktopAccountMenu />

        {/* Language / RTL toggle */}
        <Button variant="ghost" size="icon" className="h-8 w-8 text-xs" aria-label="Switch Language / RTL" onClick={toggleDirection}>
          <Languages className="h-4 w-4" />
        </Button>

        {/* Workbench Toggle */}
        <Button
          variant={workbenchCollapsed ? "outline" : "default"}
          size="sm"
          onClick={toggleWorkbench}
          className="h-8 text-xs gap-1.5 px-2.5"
          title="Toggle Workbench"
        >
          <PanelRight className="h-4 w-4" />
          <span className="hidden md:inline">Workbench</span>
        </Button>

        {/* App Version Badge */}
        <div className="hidden lg:block ms-1">
          <AppVersionBadge compact />
        </div>

        {/* Mobile Overflow Menu (360px) */}
        <div className="sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More options">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setCommandPaletteOpen(true)} className="gap-2">
                <Search className="h-4 w-4" /> Search (⌘K)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopy} className="gap-2">
                <Copy className="h-4 w-4" /> Copy Text
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleDownload("word")} className="gap-2">
                <FileType className="h-4 w-4" /> Download Word
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload("pdf")} className="gap-2">
                <File className="h-4 w-4" /> Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload("html")} className="gap-2">
                <FileCode className="h-4 w-4" /> Download HTML
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};
