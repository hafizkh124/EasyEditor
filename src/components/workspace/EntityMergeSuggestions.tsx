import React from "react";
import { Merge, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DuplicateSuggestion } from "@/lib/graph/entityResolve";
import type { Entity } from "@/lib/graph/graphService";

interface EntityMergeSuggestionsProps {
  suggestions: DuplicateSuggestion[];
  onMerge: (keep: Entity, absorb: Entity) => void;
}

const REASON_LABEL: Record<DuplicateSuggestion["reason"], string> = {
  "same-normalized-name": "ایک ہی نام، مختلف املا",
  "alias-match": "دوسرے کے متبادل ناموں میں درج",
};

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
  if (suggestions.length === 0) return null;

  return (
    <div className="mb-2 rounded-md border border-amber-500/25 bg-amber-500/5 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
        <AlertCircle className="h-3.5 w-3.5" />
        <span>ممکنہ ڈپلیکیٹ ({suggestions.length})</span>
      </div>

      {suggestions.map(({ entities: [a, b], reason }, i) => (
        <div key={i} className="rounded border border-border/60 bg-background p-1.5 space-y-1">
          <p className="text-xs text-foreground truncate">
            «{a.canonical_name}» · «{b.canonical_name}»
          </p>
          <p className="text-xs text-muted-foreground">{REASON_LABEL[reason]}</p>

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-5 px-1.5 text-xs gap-1"
              onClick={() => onMerge(a, b)}
              aria-label={`«${b.canonical_name}» کو «${a.canonical_name}» میں ضم کریں`}
            >
              <Merge className="h-2.5 w-2.5" />
              «{a.canonical_name}» رکھیں
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-5 px-1.5 text-xs gap-1"
              onClick={() => onMerge(b, a)}
              aria-label={`«${a.canonical_name}» کو «${b.canonical_name}» میں ضم کریں`}
            >
              <Merge className="h-2.5 w-2.5" />
              «{b.canonical_name}» رکھیں
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};
