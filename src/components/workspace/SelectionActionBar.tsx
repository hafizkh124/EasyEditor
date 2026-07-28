import React from "react";
import { Sparkles, Search, VolumeX, SpellCheck, RefreshCw, FileText, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";

interface SelectionActionBarProps {
  selectedText: string;
  onAddHarakat: () => void;
  onRemoveHarakat: () => void;
  onSpellCheck: () => void;
  onParaphrase: () => void;
  onSummarize: () => void;
  onCitations: () => void;
  isBusy?: boolean;
}

export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
  selectedText,
  onAddHarakat,
  onRemoveHarakat,
  onSpellCheck,
  onParaphrase,
  onSummarize,
  onCitations,
  isBusy = false,
}) => {
  // Outside a workspace (the standalone /editor page) there is no Workbench to
  // send anything to, so that one button simply doesn't appear.
  const workspace = useOptionalWorkspace();

  if (!selectedText.trim()) return null;

  const handleResearch = () => {
    workspace?.sendSelectionToWorkbench(selectedText);
  };

  return (
    <div className="flex items-center gap-1 p-1 bg-popover/95 backdrop-blur border border-border shadow-md rounded-lg text-xs z-30 select-none animate-in fade-in zoom-in-95 duration-100">
      {/* Research in Workbench */}
      {workspace && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResearch}
            className="h-7 text-xs gap-1 px-2 font-medium text-primary hover:text-primary hover:bg-primary/10"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Workbench میں تحقیق کریں</span>
          </Button>

          <div className="h-4 w-[1px] bg-border mx-0.5" />
        </>
      )}

      {/* 5 AI Actions */}
      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onAddHarakat}
        className="h-7 text-xs gap-1 px-1.5"
        title="حرکات لگائیں"
      >
        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
        <span className="hidden sm:inline">حرکات</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onRemoveHarakat}
        className="h-7 text-xs gap-1 px-1.5"
        title="حرکات ہٹائیں"
      >
        <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="hidden sm:inline">ہٹائیں</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onSpellCheck}
        className="h-7 text-xs gap-1 px-1.5"
        title="املا کی درستگی"
      >
        <SpellCheck className="h-3.5 w-3.5 text-emerald-500" />
        <span className="hidden sm:inline">املا</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onParaphrase}
        className="h-7 text-xs gap-1 px-1.5"
        title="تفہیم (Paraphrase)"
      >
        <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
        <span className="hidden sm:inline">تفہیم</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onSummarize}
        className="h-7 text-xs gap-1 px-1.5"
        title="خلاصہ"
      >
        <FileText className="h-3.5 w-3.5 text-purple-500" />
        <span className="hidden sm:inline">خلاصہ</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onCitations}
        className="h-7 text-xs gap-1 px-1.5"
        title="حوالہ جات"
      >
        <Quote className="h-3.5 w-3.5 text-indigo-500" />
        <span className="hidden sm:inline">حوالہ جات</span>
      </Button>
    </div>
  );
};
