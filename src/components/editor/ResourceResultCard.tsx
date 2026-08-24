import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import { formatCitation, type ResourceResult } from "@/lib/editor/citationFormat";
import { sourceTypeOf } from "./useResourceSearch";
import { SOURCE_CHIP_STYLE } from "./sourceColors";

interface ResourceResultCardProps {
  result: ResourceResult;
  onInsert: (result: ResourceResult) => void;
  t: import("@/lib/i18n").Translator;
}

/** One retrieved passage, with the citation it will carry into the document. */
export const ResourceResultCard = ({ result, onInsert, t }: ResourceResultCardProps) => {
  const rtl = isRtlText(result.content);
  const source = sourceTypeOf(result);
  const badgeStyle = SOURCE_CHIP_STYLE[source];

  return (
    <div className="rounded-lg border border-border bg-muted/60 p-3 group">
      {badgeStyle && (
        <span className={cn("inline-block rounded-full border px-2 py-0.5 text-xs font-medium leading-none", badgeStyle)}>
          {t(`editor.filter_${source}` as import("@/lib/i18n").TranslationKey)}
        </span>
      )}
      <p
        dir={rtl ? "rtl" : "ltr"}
        className={cn("text-sm leading-relaxed line-clamp-4 mt-1.5", rtl && "text-right")}
      >
        {result.content}
      </p>

      {result.reason && (
        <p className="mt-1.5 text-xs text-primary/80" dir="rtl">{result.reason}</p>
      )}

      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/60">
        <span className="text-xs text-muted-foreground truncate">
          {formatCitation(result.citation_ref, result.source_url)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs shrink-0"
          onClick={() => onInsert(result)}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("editor.insert")}
        </Button>
      </div>
    </div>
  );
};
