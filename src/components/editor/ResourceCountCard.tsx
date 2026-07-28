import { Hash, Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CitationSearchResponse } from "@/lib/editor/citationFormat";

interface ResourceCountCardProps {
  count: NonNullable<CitationSearchResponse["count"]>;
  onInsertSummary: () => void;
  t: (k: string) => string;
}

/**
 * The answer to a "how many times does X occur" search.
 *
 * The per-bucket table and the caveats are not decoration: a bare figure is
 * easy to trust without checking, so the number always ships with where it
 * came from and what it does not cover.
 */
export const ResourceCountCard = ({ count, onInsertSummary, t }: ResourceCountCardProps) => (
  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
    <div className="flex items-baseline gap-2">
      <Hash className="h-4 w-4 text-primary self-center" />
      <span className="text-3xl font-bold tabular-nums">{count.total}</span>
      <span className="text-sm text-muted-foreground">{t("editor.count_occurrences")}</span>
    </div>
    <p className="text-xs text-muted-foreground mt-1">
      {count.rows_matched} {t("editor.count_in_places")}
    </p>

    {count.buckets.length > 0 && (
      <div className="mt-3 max-h-44 overflow-y-auto rounded-md border border-border/60 bg-background/60">
        <table className="w-full text-xs">
          <tbody>
            {count.buckets.map((b) => (
              <tr key={`${b.source_type}-${b.key}`} className="border-b border-border/40 last:border-0">
                <td className="px-2.5 py-1.5" dir="rtl">{b.label}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">{b.occurrences}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {count.caveats.length > 0 && (
      <div className="mt-3 flex gap-1.5 text-[11px] text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <ul className="space-y-0.5" dir="rtl">
          {count.caveats.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>
    )}

    <Button size="sm" variant="outline" className="mt-3 h-7 gap-1 text-xs" onClick={onInsertSummary}>
      <Plus className="h-3.5 w-3.5" />
      {t("editor.insert_count_summary")}
    </Button>
  </div>
);
