import React from "react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  Sparkles,
  SpellCheck,
  BookOpen,
  Search,
  Loader2,
  ChevronDown,
  Type,
  RefreshCw,
  FileText,
  Wand2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ToolbarAiGroupProps {
  t: import("@/lib/i18n").Translator;
  aiBusy: string | null;
  onAddHarakat: () => void;
  onRemoveHarakat: () => void;
  onSpellCheck: () => void;
  onAutoFormat: () => void;
  onParaphrase: () => void;
  onSummarize: () => void;
  onCitations: () => void;
  onOpenResources: () => void;
  aiReview: boolean;
  onToggleAiReview: () => void;
}

export const ToolbarAiGroup: React.FC<ToolbarAiGroupProps> = ({
  t,
  aiBusy,
  onAddHarakat,
  onRemoveHarakat,
  onSpellCheck,
  onAutoFormat,
  onParaphrase,
  onSummarize,
  onCitations,
  onOpenResources,
  aiReview,
  onToggleAiReview,
}) => {
  const busy = (key: string) => aiBusy === key;
  const anyBusy = aiBusy !== null;

  return (
    <div className="flex items-center gap-0.5">
      {/* Harakat dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={anyBusy} aria-label={t("editor.harakat")}>
            {busy("add_harakat") ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-sm leading-none">{t("editor.harakat")}</span>}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onAddHarakat} disabled={anyBusy} className="cursor-pointer gap-2">
            <Sparkles className="h-4 w-4" />
            {t("editor.add_harakat")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRemoveHarakat} disabled={anyBusy} className="cursor-pointer gap-2">
            <Type className="h-4 w-4" />
            {t("editor.remove_harakat")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Citations dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={anyBusy} aria-label={t("editor.citations")}>
            {busy("citations") ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onOpenResources} disabled={anyBusy} className="cursor-pointer gap-2">
            <Search className="h-4 w-4" />
            {t("editor.search_resources")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCitations} disabled={anyBusy} className="cursor-pointer gap-2">
            <BookOpen className="h-4 w-4" />
            {t("editor.auto_sources")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Spell check */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onSpellCheck}
        disabled={anyBusy}
        aria-label={t("editor.spell_check")}
        title={t("editor.spell_check")}
      >
        {busy("spelling_check") ? <Loader2 className="h-4 w-4 animate-spin" /> : <SpellCheck className="h-4 w-4" />}
      </Button>

      {/* Paraphrase */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onParaphrase}
        disabled={anyBusy}
        aria-label={t("editor.paraphrase")}
        title={t("editor.paraphrase")}
      >
        {busy("paraphrase") ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      </Button>

      {/* Summarize */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onSummarize}
        disabled={anyBusy}
        aria-label={t("editor.summarize")}
        title={t("editor.summarize")}
      >
        {busy("summarize") ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      </Button>

      {/* Auto-format */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1 px-2 text-xs"
        onClick={onAutoFormat}
        disabled={anyBusy}
        aria-label={t("editor.auto_format")}
        title={t("editor.auto_format")}
      >
        {busy("auto_format") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        <span className="hidden sm:inline">{busy("auto_format") ? t("editor.formatting") : t("editor.auto_format")}</span>
      </Button>

      {/* AI Review toggle */}
      <Toggle
        size="sm"
        pressed={aiReview}
        onPressedChange={onToggleAiReview}
        aria-label={t("editor.ai_review")}
        title={t("editor.ai_review")}
        className="h-8 gap-1 px-2 text-xs"
      >
        <Wand2 className="h-4 w-4" />
        <span className="hidden sm:inline">{t("editor.ai_review")}</span>
      </Toggle>
    </div>
  );
};
