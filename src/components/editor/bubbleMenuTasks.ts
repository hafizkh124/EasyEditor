import type React from "react";
import {
  Sparkles, Eraser, CheckCheck, RefreshCw, FileText,
  BookmarkCheck, AlignLeft, GraduationCap, Heart, Scissors,
} from "lucide-react";
import type { SelectionBarActions } from "./useEditorAiActions";

export const TASK_ICONS: Record<string, React.FC<{ className?: string }>> = {
  add_harakat: Sparkles,
  remove_harakat: Eraser,
  spelling_check: CheckCheck,
  paraphrase: RefreshCw,
  summarize: FileText,
  citations: BookmarkCheck,
  normalize_script: AlignLeft,
  formalize: GraduationCap,
  humanize: Heart,
  shorten: Scissors,
};

/**
 * Short button captions. Deriving these from `defaultLabel.split(" ")[0]` gave
 * two different buttons the caption "علمی" (citations and formalize), so the
 * captions are spelled out here instead.
 */
export const TASK_SHORT_LABEL: Record<string, string> = {
  add_harakat: "حرکات",
  remove_harakat: "بلا حرکات",
  spelling_check: "املا",
  paraphrase: "تفہیم",
  summarize: "خلاصہ",
  citations: "حوالہ جات",
  normalize_script: "رسم الخط",
  formalize: "رسمی",
  humanize: "سلیس",
  shorten: "مختصر",
};

export function getActionHandler(
  actions: SelectionBarActions,
  taskSlug: string,
): (() => void) | undefined {
  switch (taskSlug) {
    case "add_harakat": return actions.onAddHarakat;
    case "remove_harakat": return actions.onRemoveHarakat;
    case "spelling_check": return actions.onSpellCheck;
    case "paraphrase": return actions.onParaphrase;
    case "summarize": return actions.onSummarize;
    case "citations": return actions.onCitations;
    case "normalize_script": return actions.onNormalizeScript;
    case "formalize": return actions.onFormalize;
    case "humanize": return actions.onHumanize;
    case "shorten": return actions.onShorten;
    default: return undefined;
  }
}
