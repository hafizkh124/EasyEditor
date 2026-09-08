import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Languages, Upload, FileText, Image as ImageIcon,
  Type, Loader2, Copy, ArrowRightLeft, FileEdit,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TranslationOutput from "@/components/translate/TranslationOutput";
import { useLanguage } from "@/contexts/LanguageContext";
import { translateStored } from "@/lib/i18n";
import { useTranslation, type TranslationInputType } from "@/hooks/useTranslation";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import { editorRoute } from "@/lib/routes";

const LANGUAGES = [
  { value: "auto", label: "Auto-detect" },
  { value: "ur", label: "اردو (Urdu)" },
  { value: "ar", label: "العربية (Arabic)" },
  { value: "en", label: "English" },
  { value: "fa", label: "فارسی (Persian)" },
  { value: "pa", label: "پنجابی (Punjabi)" },
  { value: "ps", label: "پښتو (Pashto)" },
];

const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.value !== "auto");

const INPUT_TYPES: { key: TranslationInputType; icon: typeof Type; labelKey: string }[] = [
  { key: "text", icon: Type, labelKey: "translate.input_text" },
  { key: "pdf", icon: FileText, labelKey: "translate.input_pdf" },
  { key: "image", icon: ImageIcon, labelKey: "translate.input_image" },
];

export const TranslatePanel = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trans = useTranslation();
  const [sourceText, setSourceText] = useState("");
  const workspaceCtx = useOptionalWorkspace();

  const currentPageData = trans.pages.find((p) => p.pageNum === trans.currentPage);

  const handleInputTypeChange = (type: TranslationInputType) => {
    trans.setInputType(type);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (trans.inputType === "pdf") {
      if (file.type !== "application/pdf") {
        toast.error(t("ocr.invalid_file", "Invalid PDF file"));
        return;
      }
      await trans.loadPdf(file);
    } else if (trans.inputType === "image") {
      if (!file.type.startsWith("image/")) {
        toast.error(t("ocr.invalid_file", "Invalid image file"));
        return;
      }
      await trans.loadImage(file);
    }
  };

  const handleTextSubmit = () => {
    if (!sourceText.trim()) return;
    trans.loadText(sourceText);
  };

  const handleTranslateAi = async () => {
    try {
      await trans.translateCurrentPage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Translation failed");
    }
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(trans.getFullTranslation());
    toast.success(t("editor.copied", "Copied to clipboard"));
  };

  const handleOpenInEditor = () => {
    const full = trans.getFullTranslation();
    if (workspaceCtx) {
      workspaceCtx.insertIntoCanvas(`<p>${full}</p>`);
      toast.success(translateStored("toast.canvas.inserted"));
    } else {
      navigate(editorRoute(), { state: { content: full, source: "manual" } });
    }
  };

  if (trans.totalPages === 0) {
    return (
      <div className="flex flex-col h-full overflow-y-auto p-4 max-w-md mx-auto w-full justify-center bg-background">
        <div className="text-center mb-4">
          <Languages className="h-8 w-8 text-primary mx-auto mb-2" />
          <h2 className="text-base font-semibold">{t("translate.title", "Quick Translate")}</h2>
        </div>

        {/* Input type selector */}
        <div className="flex gap-1.5 mb-4 w-full">
          {INPUT_TYPES.map((it) => (
            <Button
              key={it.key}
              variant={trans.inputType === it.key ? "default" : "outline"}
              className="flex-1 gap-1 text-xs h-8 px-2"
              onClick={() => handleInputTypeChange(it.key)}
            >
              <it.icon className="h-3.5 w-3.5" />
              {t(it.labelKey as import("@/lib/i18n").TranslationKey) || it.key}
            </Button>
          ))}
        </div>

        {/* Language selectors */}
        <div className="flex items-center gap-1.5 mb-4 w-full">
          <Select value={trans.sourceLanguage} onValueChange={trans.setSourceLanguage}>
            <SelectTrigger className="flex-1 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Select value={trans.targetLanguage} onValueChange={trans.setTargetLanguage}>
            <SelectTrigger className="flex-1 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TARGET_LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {trans.inputType === "text" && (
          <div className="space-y-3">
            <Textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              dir={isRtlText(sourceText) ? "rtl" : "ltr"}
              className={cn("min-h-[120px] text-xs resize-none", isRtlText(sourceText) && "text-right")}
              placeholder={t("translate.text_placeholder", "Enter text to translate...")}
            />
            <Button onClick={handleTextSubmit} disabled={!sourceText.trim()} className="w-full gap-2 h-8 text-xs">
              <Languages className="h-3.5 w-3.5" />
              {t("translate.start_translation", "Translate")}
            </Button>
          </div>
        )}

        {(trans.inputType === "pdf" || trans.inputType === "image") && (
          <div className="space-y-3">
            {trans.isProcessing ? (
              <div className="flex items-center justify-center gap-2 py-6 text-primary text-xs">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : (
              <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="w-full h-20 border-dashed gap-1.5 flex-col text-xs">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <span>{trans.inputType === "pdf" ? "Upload PDF" : "Upload Image"}</span>
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={trans.inputType === "pdf" ? "application/pdf" : "image/*"}
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold">Quick Translate</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0" aria-label="Copy translation" onClick={handleCopyAll}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0" aria-label="Insert into Canvas" onClick={handleOpenInEditor}>
            <FileEdit className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <TranslationOutput
          translationText={currentPageData?.translationText ?? ""}
          streamingText={trans.streamingText}
          isTranslating={trans.isTranslating}
          onTranslateAi={handleTranslateAi}
          onUpdateText={(text) => trans.updateTranslation(trans.currentPage, text)}
          onVoiceResult={() => {}}
          t={t}
        />
      </div>
    </div>
  );
};
