import React from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useLanguage } from "@/contexts/LanguageContext";
import { TrustTab } from "./TrustTab";

interface AiActivitySheetProps {
  /** Which edge it slides in from — the reading-end of the page, like Versions. */
  side: "left" | "right";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The full record of what the AI did on THIS document — every run, the model,
 * tokens, confidence, retry of a failed one, and the sources each citation run
 * used. It used to be the workbench's "Audit" tab; a record you consult now and
 * then does not need a permanent tab beside the two you work in all day, so it
 * lives beside Versions in the top bar (the same kind of thing: a history of
 * this document). A short summary of what each answer drew on stays under the
 * answer itself (provenance chips).
 *
 * Chat sessions have their own history in the activity rail.
 */
export const AiActivitySheet: React.FC<AiActivitySheetProps> = ({ side, open, onOpenChange }) => {
  const { t } = useLanguage();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 px-2 hidden sm:flex" aria-label={t("workbench.trust", "AI activity")}>
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t("workbench.trust", "AI activity")}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side={side} className="w-[22rem] max-w-full p-0 sm:w-[26rem]">
        <SheetHeader className="px-4 pt-4">
          <SheetTitle className="text-base">{t("library.trust_title", "AI runs & sources")}</SheetTitle>
        </SheetHeader>
        {/* Mounted only while open: the record is read from the database on mount. */}
        {open && <TrustTab />}
      </SheetContent>
    </Sheet>
  );
};
