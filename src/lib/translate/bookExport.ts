import { isRtlText } from "@/utils/textUtils";
import { alignParagraphs, splitParagraphs } from "./paragraphs";

/**
 * A finished translation as a document (SYSTEM-2026 §6): the translation
 * alone, or bilingual — source and translation side by side, one table row per
 * paragraph. The HTML feeds the Word exporter and the editor alike.
 */

export type BookExportMode = "translation" | "bilingual";

export interface ExportPage {
  pageNum: number;
  sourceText?: string;
  translationText: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dirOf(text: string): "rtl" | "ltr" {
  return isRtlText(text) ? "rtl" : "ltr";
}

function para(text: string): string {
  return `<p dir="${dirOf(text)}">${escapeHtml(text)}</p>`;
}

function cell(text: string): string {
  return `<td dir="${dirOf(text)}">${escapeHtml(text).replace(/\n+/g, "<br>")}</td>`;
}

export function buildBookHtml(
  pages: readonly ExportPage[],
  mode: BookExportMode,
  { pageLabel = "Page" }: { pageLabel?: string } = {},
): string {
  const translated = pages.filter((p) => p.translationText.trim());
  const withHeadings = translated.length > 1 || pages.length > 1;
  return translated
    .map((page) => {
      const heading = withHeadings ? `<h2>${escapeHtml(`${pageLabel} ${page.pageNum}`)}</h2>` : "";
      const target = splitParagraphs(page.translationText);
      if (mode === "translation" || !page.sourceText?.trim()) {
        return heading + target.map(para).join("");
      }
      const source = splitParagraphs(page.sourceText);
      const aligned = alignParagraphs(source, page.translationText);
      const rows = aligned
        ? source.map((s, i) => `<tr>${cell(s)}${cell(aligned[i])}</tr>`)
        : [`<tr>${cell(source.join("\n"))}${cell(target.join("\n"))}</tr>`];
      return `${heading}<table><tbody>${rows.join("")}</tbody></table>`;
    })
    .join("");
}
