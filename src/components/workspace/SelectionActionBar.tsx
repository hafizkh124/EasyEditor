import React from "react";
import { Sparkles, Search, VolumeX, SpellCheck, RefreshCw, FileText, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { useLanguage } from "@/contexts/LanguageContext";

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
  const { t } = useLanguage();
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
            <span>{t("library.research_in_workbench", "Research in Workbench")}</span>
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
        title={t("library.harakat_full", "Add harakat")}
      >
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="hidden sm:inline">{t("library.harakat_short", "Harakat")}</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onRemoveHarakat}
        className="h-7 text-xs gap-1 px-1.5"
        title={t("library.remove_harakat_full", "Remove harakat")}
      >
        <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="hidden sm:inline">{t("library.remove_short", "Remove")}</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onSpellCheck}
        className="h-7 text-xs gap-1 px-1.5"
        title={t("library.spell_full", "Spell check")}
      >
        <SpellCheck className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="hidden sm:inline">{t("library.spell_short", "Spell")}</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onParaphrase}
        className="h-7 text-xs gap-1 px-1.5"
        title={t("library.paraphrase_full", "Paraphrase")}
      >
        <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="hidden sm:inline">{t("library.paraphrase_short", "Paraphrase")}</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onSummarize}
        className="h-7 text-xs gap-1 px-1.5"
        title={t("library.summarize_full", "Summarize")}
      >
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="hidden sm:inline">{t("library.summarize_short", "Summarize")}</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={onCitations}
        className="h-7 text-xs gap-1 px-1.5"
        title={t("library.citations_full", "Citations")}
      >
        <Quote className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="hidden sm:inline">{t("library.citations_short", "Citations")}</span>
      </Button>
    </div>
  );
};
