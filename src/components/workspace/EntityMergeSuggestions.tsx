import React from "react";
import { Merge, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DuplicateSuggestion } from "@/lib/graph/entityResolve";
import type { Entity } from "@/lib/graph/graphService";

interface EntityMergeSuggestionsProps {
  suggestions: DuplicateSuggestion[];
  onMerge: (keep: Entity, absorb: Entity) => void;
}

/**
 * Possible duplicate entities — a proposal, never an action (SPEC-M4 FR-3.3).
 *
 * The user picks which record survives, because «ابن تیمیہ»/«ابن تیمیۃ» being
 * one scholar and two similarly-spelled scholars being two are not
 * distinguishable by any normalisation we can write.
 */
export const EntityMergeSuggestions: React.FC<EntityMergeSuggestionsProps> = ({
  suggestions,
  onMerge,
}) => {
  const { t } = useLanguage();
  if (suggestions.length === 0) return null;

  const reasonLabel: Record<DuplicateSuggestion["reason"], string> = {
    "same-normalized-name": t("library.merge_reason_same", "Same name, different spelling"),
    "alias-match": t("library.merge_reason_alias", "Listed in the other's aliases"),
  };

  return (
    <div className="mb-2 rounded-md border border-amber-500/25 bg-amber-500/5 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
        <AlertCircle className="h-3.5 w-3.5" />
        <span>{t("library.possible_duplicates", "Possible duplicates ({count})").replace("{count}", String(suggestions.length))}</span>
      </div>

      {suggestions.map(({ entities: [a, b], reason }, i) => (
        <div key={i} className="rounded border border-border/60 bg-background p-1.5 space-y-1">
          <p className="text-xs text-foreground truncate">
            «{a.canonical_name}» · «{b.canonical_name}»
          </p>
          <p className="text-xs text-muted-foreground">{reasonLabel[reason]}</p>

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-5 px-1.5 text-xs gap-1"
              onClick={() => onMerge(a, b)}
              aria-label={t("library.merge_aria", "Merge «{b}» into «{a}»").replace("{b}", b.canonical_name).replace("{a}", a.canonical_name)}
            >
              <Merge className="h-3 w-3" />
              {t("library.keep", "Keep «{name}»").replace("{name}", a.canonical_name)}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-5 px-1.5 text-xs gap-1"
              onClick={() => onMerge(b, a)}
              aria-label={t("library.merge_aria", "Merge «{b}» into «{a}»").replace("{b}", a.canonical_name).replace("{a}", b.canonical_name)}
            >
              <Merge className="h-3 w-3" />
              {t("library.keep", "Keep «{name}»").replace("{name}", b.canonical_name)}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};
