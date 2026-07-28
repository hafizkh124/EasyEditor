import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle, FontFamily } from "@tiptap/extension-text-style";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { TrackChangesExtension } from "tiptap-track-changes";

export interface TrackChangesAuthor {
  id: string;
  name: string;
  color: string;
}

export const DEFAULT_TRACK_AUTHOR: TrackChangesAuthor = {
  id: "anon",
  name: "You",
  color: "#2d5fce",
};

/**
 * The editor's schema, in one place.
 *
 * RichEditor and the book-section migration must agree on this list: parsing
 * stored HTML with a narrower schema silently drops whatever it doesn't know
 * (a blockquote collapses into a paragraph, a bold mark disappears), and the
 * loss is only visible once someone opens the migrated document.
 *
 * Placeholder is deliberately excluded — it is a UI affordance with no schema
 * of its own, so it belongs to the live editor rather than to HTML parsing.
 */
export function buildEditorExtensions(author: TrackChangesAuthor = DEFAULT_TRACK_AUTHOR) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyle,
    FontFamily,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TrackChangesExtension.configure({ author, mode: "edit" }),
  ];
}
