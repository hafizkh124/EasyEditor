import { useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileText, Download, Copy, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import RichEditor from "@/components/editor/RichEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSeo } from "@/hooks/useSeo";

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

  const handleExportTxt = () => {
    const blob = new Blob([currentText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "document"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("editor.exported"));
  };

  const handleExportHtml = () => {
    const fullHtml = `<!DOCTYPE html><html dir="auto"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.7}</style></head><body>${currentHtml}</body></html>`;
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "document"}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("editor.exported"));
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
            <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={handleExportTxt}>
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">TXT</span>
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={handleExportHtml}>
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">HTML</span>
            </Button>
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
