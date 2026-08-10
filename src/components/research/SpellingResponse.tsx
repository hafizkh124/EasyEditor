import { useMemo } from "react";
import { toast } from "sonner";
import { Copy, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isRtlText } from "@/utils/textUtils";
import { cn } from "@/lib/utils";
import type { SpellingChange } from "@/lib/research/streamers";

interface SpellingResponseProps {
  original: string;
  corrected: string;
  changes: SpellingChange[];
  t: import("@/lib/i18n").Translator;
}

/**
 * Render the corrected text with inline <ins> / <del> markers (FR-1.3).
 *
 * We don't trust the model's offsets blindly because Unicode scripts (especially
 * Arabic/Urdu with diacritics) can make character offsets drift. Instead we
 * locate each `original` token inside the `corrected` string and replace it
 * with `<del>original</del><ins>corrected</ins>`. If lookup fails, fall back to
 * plain corrected text for that change.
 */
function buildSegments(
  corrected: string,
  changes: SpellingChange[],
): Array<{ kind: "text" | "change"; value: string; original?: string; corrected?: string }> {
  if (changes.length === 0) {
    return [{ kind: "text", value: corrected }];
  }

  const hits: Array<{ start: number; end: number; change: SpellingChange }> = [];
  let cursor = 0;
  for (const c of changes) {
    const idx = corrected.indexOf(c.corrected, cursor);
    if (idx === -1) continue;
    hits.push({ start: idx, end: idx + c.corrected.length, change: c });
    cursor = idx + c.corrected.length;
  }

  const out: Array<{ kind: "text" | "change"; value: string; original?: string; corrected?: string }> = [];
  let pos = 0;
  for (const hit of hits) {
    if (hit.start > pos) out.push({ kind: "text", value: corrected.slice(pos, hit.start) });
    out.push({
      kind: "change",
      value: hit.change.corrected,
      original: hit.change.original,
      corrected: hit.change.corrected,
    });
    pos = hit.end;
  }
  if (pos < corrected.length) out.push({ kind: "text", value: corrected.slice(pos) });
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Write to clipboard with both text/html and text/plain representations.
 * Falls back to plain-text writeText if ClipboardItem is unavailable (older browsers).
 */
async function writeRich(html: string, plain: string): Promise<void> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return;
    }
  } catch { /* fall through */ }
  await navigator.clipboard.writeText(plain);
}

const SpellingResponse = ({ original, corrected, changes, t }: SpellingResponseProps) => {
  void original; // reserved for potential diff views; kept so callers can pass it
  const segments = useMemo(() => buildSegments(corrected, changes), [corrected, changes]);
  const rtl = isRtlText(corrected);

  const copyClean = async () => {
    await navigator.clipboard.writeText(corrected);
    toast.success(t("research.copied_clean"));
  };

  const copyWithHighlights = async () => {
    const htmlParts: string[] = [];
    const mdParts: string[] = [];
    for (const seg of segments) {
      if (seg.kind === "text") {
        htmlParts.push(escapeHtml(seg.value));
        mdParts.push(seg.value);
      } else {
        htmlParts.push(
          `<del>${escapeHtml(seg.original ?? "")}</del><ins>${escapeHtml(seg.corrected ?? "")}</ins>`,
        );
        mdParts.push(`~~${seg.original ?? ""}~~ **${seg.corrected ?? ""}**`);
      }
    }
    await writeRich(htmlParts.join(""), mdParts.join(""));
    toast.success(t("research.copied_with_highlights"));
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {changes.length === 0 ? t("research.spelling_no_changes") : t("research.spelling_title", )}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
              <Copy className="h-3 w-3" />
              {t("research.copy")}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={copyClean}>{t("research.copy_clean")}</DropdownMenuItem>
            <DropdownMenuItem onClick={copyWithHighlights}>
              {t("research.copy_with_highlights")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        dir={rtl ? "rtl" : "ltr"}
        className={cn("whitespace-pre-wrap text-sm text-foreground leading-relaxed", rtl && "text-right")}
      >
        {segments.map((seg, i) =>
          seg.kind === "text" ? (
            <span key={i}>{seg.value}</span>
          ) : (
            <span key={i} className="inline-flex items-baseline gap-0.5">
              <del
                title={t("research.spelling_was")}
                className="text-destructive/80 bg-destructive/10 rounded px-1 mx-0.5 decoration-destructive"
              >
                {seg.original}
              </del>
              <ins
                title={t("research.spelling_now")}
                className="text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded px-1 mx-0.5 no-underline font-medium"
              >
                {seg.corrected}
              </ins>
            </span>
          ),
        )}
      </div>
      {changes.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          {changes.length} {changes.length === 1 ? t("research.change_singular") : t("research.change_plural")}
        </p>
      )}
    </div>
  );
};

export default SpellingResponse;
