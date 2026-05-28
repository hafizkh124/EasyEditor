import { useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileText, Download, Copy, ArrowLeft, ChevronDown, FileType, FileCode, File } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import RichEditor from "@/components/editor/RichEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSeo } from "@/hooks/useSeo";
import { exportTxt, exportHtml, exportDoc, exportPdf, stripSuggestions } from "@/lib/editor/exporters";

interface EditorLocationState {
  content?: string;
  source?: "research" | "ocr" | "transcribe" | "manual";
}

const Editor = () => {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as EditorLocationState) ?? {};

  useSeo({ title: "Editor — Easy Editor", description: "Rich text editor for editing transcriptions, OCR results, and research output.", path: "/editor" });

  const [title, setTitle] = useState(() => {
    if (state.source === "research") return t("editor.from_research");
    if (state.source === "ocr") return t("editor.from_ocr");
    if (state.source === "transcribe") return t("editor.from_transcribe");
    return t("editor.untitled");
  });

  const [currentText, setCurrentText] = useState("");
  const [currentHtml, setCurrentHtml] = useState("");

  const handleEditorChange = useCallback((html: string, text: string) => {
    setCurrentHtml(html);
    setCurrentText(text);
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(currentText);
    toast.success(t("editor.copied"));
  };

  const handleDownload = (format: "word" | "pdf" | "html" | "txt") => {
    switch (format) {
      case "word": exportDoc(currentHtml, title); break;
      case "pdf": exportPdf(currentHtml, title); break;
      case "html": exportHtml(currentHtml, title); break;
      case "txt": {
        // Accept-all implied: drop suggestion markup, then extract plain text.
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
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <FileText className="h-5 w-5 text-primary shrink-0" />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 text-base font-semibold border-0 bg-transparent shadow-none focus-visible:ring-0 px-1 max-w-md"
            placeholder={t("editor.untitled")}
          />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto">
            <RichEditor
              initialContent={state.content ?? ""}
              placeholder={t("editor.placeholder")}
              onChange={handleEditorChange}
            />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Editor;
