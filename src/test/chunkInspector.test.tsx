import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChunkInspectorDialog, CHUNK_PAGE_SIZE } from "@/components/workspace/ChunkInspectorDialog";
import { libraryChunkService } from "@/lib/corpus/libraryChunkService";
import type { LibraryItem } from "@/core/workspace/types";
import type { LibraryChunkInfo } from "@/core/backend/types";

// The real `t` resolves keys against the locale files; the mock returns the
// English fallback so assertions read naturally and don't depend on the language.
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_k: string, f: string) => f, direction: "ltr" }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const makeItem = (over: Partial<LibraryItem["meta"]> = {}): LibraryItem => ({
  id: "item-123",
  user_id: "user-123",
  title: "Sahih al-Bukhari — Kitab al-Iman",
  kind: "book",
  created_at: "2026-09-20T00:00:00Z",
  updated_at: "2026-09-20T00:00:00Z",
  meta: { ingest: { chunker: "adaptive-v1", total_chunks: 2, status: "ready" }, ...over },
});

const mockChunks: LibraryChunkInfo[] = [
  {
    id: "chunk-1", chunk_index: 0,
    content: "حدثنا عبد الله بن يوسف قال أخبرنا مالك عن هشام بن عروة عن أبيه عن عائشة أم المؤمنين",
    char_start: 0, char_end: 86,
    meta: { kind: "hadith", isnad: "حدثنا عبد الله بن يوسف قال أخبرنا مالك", heading: "باب كيف كان بدء الوحي إلى رسول الله" },
  },
  {
    id: "chunk-2", chunk_index: 1,
    content: "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى",
    char_start: 87, char_end: 130,
    meta: { kind: "fiqh", heading: "باب ما جاء أن الأعمال بالنية والحسبة" },
  },
];

const many = (from: number, n: number): LibraryChunkInfo[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c-${from + i}`, chunk_index: from + i, content: `passage number ${from + i}`,
    char_start: (from + i) * 10, char_end: (from + i) * 10 + 9, meta: { kind: "prose" },
  }));

const renderDialog = (item = makeItem()) =>
  render(<ChunkInspectorDialog item={item} open={true} onOpenChange={vi.fn()} />);

describe("ChunkInspectorDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toast.success.mockClear();
    toast.error.mockClear();
  });

  it("loads the first page and shows the chunks with their isnad and chapter", async () => {
    const spy = vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce(mockChunks);
    renderDialog();

    expect(screen.getByText("Sahih al-Bukhari — Kitab al-Iman")).toBeInTheDocument();
    expect(screen.getByText("Adaptive v1 (structural)")).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledWith("item-123", CHUNK_PAGE_SIZE, 0));

    expect((await screen.findAllByText(/حدثنا عبد الله بن يوسف/)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/إنما الأعمال بالنيات/)).toBeInTheDocument();
    expect(screen.getByText("باب كيف كان بدء الوحي إلى رسول الله")).toBeInTheDocument();
    expect(screen.getByText(/Isnad/)).toBeInTheDocument();
  });

  it("filters the loaded chunks by search text", async () => {
    vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce(mockChunks);
    renderDialog();
    await screen.findByText(/إنما الأعمال بالنيات/);

    fireEvent.change(screen.getByPlaceholderText("Search chunk text, index or chapter…"), { target: { value: "بالنيات" } });

    expect(screen.queryAllByText(/حدثنا عبد الله بن يوسف/)).toHaveLength(0);
    expect(screen.getByText(/إنما الأعمال بالنيات/)).toBeInTheDocument();
  });

  it("says so when a document genuinely has no chunks", async () => {
    vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce([]);
    renderDialog();
    expect(await screen.findByText("This document has no chunks.")).toBeInTheDocument();
  });

  it("REGRESSION: a failed load shows an error with Retry — not 'no chunks'", async () => {
    // The dialog used to toast the error and then render the empty-book message,
    // telling the user a perfectly good book had no chunks.
    const spy = vi.spyOn(libraryChunkService, "listChunks")
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce(mockChunks);
    renderDialog();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load chunks");
    expect(alert).toHaveTextContent("permission denied");
    expect(screen.queryByText("This document has no chunks.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/إنما الأعمال بالنيات/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("REGRESSION: a long book is paged — it says how much is shown and loads the rest on demand", async () => {
    // It used to fetch 500 chunks, show 'Total: 2000' and silently stop.
    const item = makeItem({ ingest: { chunker: "adaptive-v1", total_chunks: 250, status: "ready" } });
    const spy = vi.spyOn(libraryChunkService, "listChunks")
      .mockResolvedValueOnce(many(0, CHUNK_PAGE_SIZE))
      .mockResolvedValueOnce(many(CHUNK_PAGE_SIZE, 50));
    renderDialog(item);

    await screen.findByText("passage number 0");
    expect(screen.getByText(`Showing ${CHUNK_PAGE_SIZE} of 250 chunks`)).toBeInTheDocument();
    expect(screen.queryByText(`passage number ${CHUNK_PAGE_SIZE}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText(`passage number ${CHUNK_PAGE_SIZE}`)).toBeInTheDocument();
    // the second request continues from where the first stopped
    expect(spy).toHaveBeenLastCalledWith("item-123", CHUNK_PAGE_SIZE, CHUNK_PAGE_SIZE);
    expect(screen.getByText(`Showing ${CHUNK_PAGE_SIZE + 50} of 250 chunks`)).toBeInTheDocument();
    // a short page means we reached the end: no more button
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("warns that search only covers what is loaded while more remain", async () => {
    vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce(many(0, CHUNK_PAGE_SIZE));
    renderDialog(makeItem({ ingest: { chunker: "adaptive-v1", total_chunks: 500, status: "ready" } }));
    await screen.findByText("passage number 0");

    fireEvent.change(screen.getByPlaceholderText("Search chunk text, index or chapter…"), { target: { value: "passage number 7" } });
    expect(screen.getByText(/search covers the loaded chunks only/)).toBeInTheDocument();
  });

  it("does not offer 'Load more' for a short book", async () => {
    vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce(mockChunks);
    renderDialog();
    await screen.findByText(/إنما الأعمال بالنيات/);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("labels a legacy-ingested document as such", async () => {
    vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce(mockChunks);
    renderDialog(makeItem({ ingest: { status: "ready", total_chunks: 2 } }));
    expect(screen.getByText("Legacy chunker")).toBeInTheDocument();
  });

  describe("copy", () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    afterEach(() => {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    });

    it("copies the chunk text and confirms", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce(mockChunks);
      renderDialog();
      await screen.findByText(/إنما الأعمال بالنيات/);

      fireEvent.click(screen.getAllByRole("button", { name: /Copy/ })[1]);

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Text copied"));
      expect(writeText).toHaveBeenCalledWith(mockChunks[1].content);
    });

    it("REGRESSION: a refused clipboard write reports failure instead of a false 'copied'", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce(mockChunks);
      renderDialog();
      await screen.findByText(/إنما الأعمال بالنيات/);

      fireEvent.click(screen.getAllByRole("button", { name: /Copy/ })[0]);

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not copy"));
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
