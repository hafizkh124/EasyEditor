import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "@/components/editor/editorExtensions";

/**
 * SYSTEM-2026 §3 — the folder index ("اس فولڈر میں"): the open document's
 * folder like a book's index, with the open document's headings as the
 * second level.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string, fallback?: string) => fallback ?? key, direction: "rtl" }),
}));

const doc = (id: string, title: string, sort_order: number, updated_at: string, project_id = "p1") => ({
  id, project_id, user_id: "u", title, doc_type: "doc", content_json: {}, plain_text: "", sort_order,
  status: "draft", word_count: 0, created_at: updated_at, updated_at,
});
const docs = [doc("d1", "ب دوسرا", 1, "2026-01-02T00:00:00Z"), doc("d2", "الف پہلا", 0, "2026-01-01T00:00:00Z"), doc("d3", "ج تیسرا", 2, "2026-01-03T00:00:00Z")];
const refresh = vi.fn(async () => {});
vi.mock("@/core/workspace/useAllDocuments", () => ({
  useAllDocuments: () => ({
    loading: false,
    refresh,
    projects: [{ id: "p1", title: "فتاویٰ زکوٰۃ", kind: "general", meta: { pinnedSources: [{ ref: "shamela:77", label: "بدائع الصنائع" }, { ref: "corpus:abc", label: "میرا PDF" }] } }, { id: "p2", title: "خطبات", kind: "general" }, { id: "t1", title: "ترجمہ", kind: "translation" }],
    docsMap: { p1: docs, p2: [] },
    allDocs: docs.map((d) => ({ ...d, projectName: "فتاویٰ زکوٰۃ", projectKind: "general" })),
  }),
}));
const updateDocument = vi.fn(async () => ({}));
const updateProject = vi.fn(async () => ({}));
vi.mock("@/core/workspace/documentService", () => ({
  documentService: {
    updateDocument: (...a: unknown[]) => updateDocument(...(a as [])),
    updateProject: (...a: unknown[]) => updateProject(...(a as [])),
    createDocument: vi.fn(),
  },
}));

vi.mock("@/hooks/useSessionHistory", () => ({
  useSessionHistory: () => ({
    loading: false,
    items: [
      { id: "c1", title: "زکوٰۃ پر گفتگو", project_id: "p1", updated_at: "" },
      { id: "c2", title: "دوسرے فولڈر کی", project_id: "p2", updated_at: "" },
    ],
  }),
}));

const ws = {
  activeDocumentId: "d1" as string | null,
  openChatSession: vi.fn(),
  setActiveDocumentId: vi.fn(),
  documentOutline: [
    { text: "باب اول", level: 2 },
    { text: "", level: 2 },
    { text: "فصل", level: 3 },
    { text: "بہت گہرا", level: 5 },
  ],
  jumpToHeading: vi.fn(),
  headingJump: null as { index: number; nonce: number } | null,
};
vi.mock("@/core/workspace/WorkspaceContext", () => ({ useWorkspace: () => ws, useOptionalWorkspace: () => ws }));

import { FolderIndexPanel } from "@/components/workspace/rail/FolderIndexPanel";
import { useHeadingJump } from "@/components/editor/useHeadingJump";

const renderPanel = () =>
  render(
    <MemoryRouter>
      <FolderIndexPanel />
    </MemoryRouter>,
  );
const docButtons = () =>
  within(screen.getByRole("list", { name: "دستاویزات" })).getAllByRole("button").filter((b) => !b.closest("[aria-label='عنوانات']"));

describe("FolderIndexPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    ws.activeDocumentId = "d1";
  });

  it("shows the open document's folder in its own order", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "فتاویٰ زکوٰۃ" })).toBeInTheDocument();
    expect(docButtons().map((b) => b.textContent)).toEqual(["الف پہلا", "ب دوسرا", "ج تیسرا"]);
    expect(screen.getByRole("button", { name: "ب دوسرا" })).toHaveAttribute("aria-current", "page");
  });

  it("unfolds the open document into its headings and jumps to the one picked", () => {
    renderPanel();
    const headings = within(screen.getByRole("list", { name: "عنوانات" })).getAllByRole("button");
    // The empty heading and the one deeper than level 3 are left out…
    expect(headings.map((b) => b.textContent)).toEqual(["باب اول", "فصل"]);
    // …but positions stay those of the editor's headings.
    fireEvent.click(headings[1]);
    expect(ws.jumpToHeading).toHaveBeenCalledWith(2);
  });

  it("drag reorders and saves the new order", async () => {
    renderPanel();
    const rows = docButtons().map((b) => b.closest("li")!);
    fireEvent.dragStart(rows[2]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);
    expect(docButtons().map((b) => b.textContent)).toEqual(["ج تیسرا", "الف پہلا", "ب دوسرا"]);
    await waitFor(() => expect(updateDocument).toHaveBeenCalledWith("d3", { sort_order: 0 }));
    expect(updateDocument).toHaveBeenCalledWith("d2", { sort_order: 1 });
    expect(updateDocument).toHaveBeenCalledWith("d1", { sort_order: 2 });
  });

  it("can order by name or date instead", () => {
    localStorage.setItem("workspace.folderIndex.sort", "date");
    renderPanel();
    expect(docButtons().map((b) => b.textContent)).toEqual(["ج تیسرا", "ب دوسرا", "الف پہلا"]);
  });

  it("lists this folder's chats and opens one beside the document", () => {
    renderPanel();
    const chats = screen.getByRole("list", { name: "چیٹس" });
    expect(within(chats).queryByText("دوسرے فولڈر کی")).not.toBeInTheDocument();
    fireEvent.click(within(chats).getByRole("button", { name: "زکوٰۃ پر گفتگو" }));
    expect(ws.openChatSession).toHaveBeenCalledWith("c1");
  });

  it("lists the folder's pinned sources; a Shamela book opens in the reader, and one can be unpinned", async () => {
    renderPanel();
    const sources = screen.getByRole("list", { name: "ذرائع" });
    fireEvent.click(within(sources).getByRole("button", { name: "بدائع الصنائع" }));
    expect(ws.setActiveDocumentId).toHaveBeenCalledWith("77");
    // A personal file has no reader, so it is listed but not a link.
    expect(within(sources).queryByRole("button", { name: "میرا PDF" })).not.toBeInTheDocument();
    fireEvent.click(within(sources).getByRole("button", { name: /پن ہٹائیں: بدائع الصنائع/ }));
    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith("p1", { meta: { pinnedSources: [{ ref: "corpus:abc", label: "میرا PDF" }] } }),
    );
  });

  it("with nothing open, lists the folders (not translations) to pick one", () => {
    ws.activeDocumentId = null;
    renderPanel();
    expect(screen.queryByRole("button", { name: /ترجمہ/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /فتاویٰ زکوٰۃ/ }));
    expect(screen.getByRole("heading", { name: "فتاویٰ زکوٰۃ" })).toBeInTheDocument();
  });
});

describe("useHeadingJump", () => {
  it("publishes the outline as soon as content is loaded, and on every change", () => {
    const editor = new Editor({ extensions: buildEditorExtensions(), content: "<h1>الف</h1><p>متن</p><h3>ب</h3>" });
    const setDocumentOutline = vi.fn();
    Object.assign(ws, { setDocumentOutline });
    renderHook(() => useHeadingJump(editor as never));
    expect(setDocumentOutline).toHaveBeenLastCalledWith([{ text: "الف", level: 1 }, { text: "ب", level: 3 }]);
    editor.commands.setContent("<h2>ج</h2>");
    expect(setDocumentOutline).toHaveBeenLastCalledWith([{ text: "ج", level: 2 }]);
    Object.assign(ws, { setDocumentOutline: undefined });
    editor.destroy();
  });

  it("moves the caret to the nth heading", () => {
    const editor = new Editor({ extensions: buildEditorExtensions(), content: "<h2>الف</h2><p>متن</p><h2>ب</h2><p>اور</p>" });
    ws.headingJump = { index: 1, nonce: 1 };
    renderHook(() => useHeadingJump(editor as never));
    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe("heading");
    expect($from.parent.textContent).toBe("ب");
    ws.headingJump = null;
    editor.destroy();
  });
});
