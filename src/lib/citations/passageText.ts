import { formatCitation } from "@/components/research/CitationBadge";
import type { CitationItem } from "~shared/research/citationTypes";

/** Passage + its reference (+ link), ready to paste into a document. */
export function passageClipboardText(item: CitationItem): string {
  const ref = formatCitation(item.domain, item.citation_ref);
  const url = item.url ?? item.citation_ref.url;
  return [item.content?.trim(), ref, url].filter(Boolean).join("\n");
}
