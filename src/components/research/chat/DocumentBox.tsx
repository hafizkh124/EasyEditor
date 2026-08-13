import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sparkles, PenLine, MessageSquare, Minimize2, Loader2, RefreshCw, FileText, Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isRtlText as detectRtl } from "@/utils/textUtils";
import type { Translator } from "@/lib/i18n";

interface DocumentBoxProps {
  content: string;
  isRefining: boolean;
  onRefine: (action: string) => void;
  onCopy: () => void;
  onRegenerate?: () => void;
  onOpenInEditor?: () => void;
  t: Translator;
}

/**
 * The full-width answer surface: the assistant's latest reply rendered as a
 * document with refine actions above it and hand-off actions below.
 *
 * Direction is detected from the content rather than the UI language — a reply
 * can be Arabic while the interface is English, and vice versa.
 */
export const DocumentBox = ({
  content, isRefining, onRefine, onCopy, onRegenerate, onOpenInEditor, t,
}: DocumentBoxProps) => {
  const isRtl = detectRtl(content);

  return (
    <div className="relative rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center gap-1.5 p-2 border-b border-border bg-muted/60 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground mr-1 flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5" />
          {t("research.ai_tools")}
        </span>
        <Separator orientation="vertical" className="h-5" />
        {[
          { action: "formalize", icon: PenLine, label: t("research.formalize") },
          { action: "humanize", icon: MessageSquare, label: t("research.humanize") },
          { action: "shorten", icon: Minimize2, label: t("research.shorten") },
        ].map((btn) => (
          <Button
            key={btn.action}
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={isRefining}
            onClick={() => onRefine(btn.action)}
          >
            <btn.icon className="h-3 w-3" />
            {btn.label}
          </Button>
        ))}
      </div>

      {isRefining && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-opacity duration-300">
          <div className="flex items-center gap-2 text-primary">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">{t("research.refining")}</span>
          </div>
        </div>
      )}

      <div
        dir={isRtl ? "rtl" : "ltr"}
        className={cn(
          "px-4 py-5 sm:px-6 sm:py-5 prose prose-sm dark:prose-invert max-w-none min-h-[200px] leading-relaxed",
          isRtl && "text-right",
        )}
      >
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>

      <div className="flex items-center justify-between gap-2 p-2.5 border-t border-border flex-wrap">
        <div className="flex items-center gap-1">
          {onRegenerate && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground h-8 text-xs" onClick={onRegenerate} disabled={isRefining}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("research.regenerate")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onOpenInEditor && (
            <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={onOpenInEditor}>
              <FileText className="h-3.5 w-3.5" />
              {t("editor.open_in_editor")}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
            {t("research.copy")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DocumentBox;
