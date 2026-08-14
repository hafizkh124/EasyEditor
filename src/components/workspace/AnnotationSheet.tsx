import React, { useState } from "react";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useLanguage } from "@/contexts/LanguageContext";
import { AnnotationList } from "./AnnotationList";
import type { AnnotationItem } from "@/core/workspace/annotationService";

interface AnnotationSheetProps {
  annotations: AnnotationItem[];
  hasSelection: boolean;
  onCreateAnnotation: (note: string) => void;
  onDeleteAnnotation: (id: string) => void;
}

/**
 * Margin notes as a drawer rather than a panel tab (SPEC-M4 FR-1.3).
 *
 * The Workbench is already at five tabs and the Library at four; a sheet keeps
 * notes one click away without pushing either strip past what fits at 320px.
 * Same pattern as `VersionHistorySheet`.
 */
export const AnnotationSheet: React.FC<AnnotationSheetProps> = ({
  annotations,
  hasSelection,
  onCreateAnnotation,
  onDeleteAnnotation,
}) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const detached = annotations.filter((a) => a.anchor?.isDetached).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1 px-2 text-amber-700 hover:bg-amber-500/10"
          aria-label={t("annotations.title_count", "Margin Notes ({count})").replace("{count}", String(annotations.length))}
        >
          <StickyNote className="h-3.5 w-3.5" />
          <span>{t("annotations.title", "Margin Notes")}</span>
          {annotations.length > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-bold">
              {annotations.length}
              {detached > 0 && <span className="text-muted-foreground">{t("annotations.detached_count", " · {count} detached").replace("{count}", String(detached))}</span>}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="w-[320px] sm:w-[380px] p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>{t("annotations.title", "Margin Notes")}</SheetTitle>
        </SheetHeader>
        <AnnotationList
          annotations={annotations}
          hasSelection={hasSelection}
          onCreateAnnotation={onCreateAnnotation}
          onDeleteAnnotation={onDeleteAnnotation}
        />
      </SheetContent>
    </Sheet>
  );
};
