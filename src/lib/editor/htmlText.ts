/** Escaping and plain-text → HTML helpers shared by the editor and the panels. */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert plain text into paragraph HTML. Blank lines separate paragraphs;
 * single newlines become `<br>`. Note what this cannot do: the result is only
 * ever paragraphs, so applying it to a whole document flattens headings, lists,
 * quotes and tables — see `applyScope` for who is allowed to do that.
 */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
