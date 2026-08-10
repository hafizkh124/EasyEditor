import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowseTab } from "@/components/workspace/BrowseTab";

/**
 * BrowseTab's state machine, pinned before it is refactored.
 *
 * The component carries 17 `useState`s driving one flow: detect the native
 * Shamela bridge → list categories/authors/periods → drill into one → load its
 * books → open a book. These tests assert that flow's transitions and the calls
 * it makes, deliberately NOT its markup, so the planned extraction of the state
 * machine into a hook can be verified rather than hoped at.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, direction: "rtl", language: "ur" }),
}));

// BookCover fetches cover art over IPC; irrelevant here and noisy if left real.
// It must render no text — the card already prints the title, and a second copy
// makes every `findByText` on a book ambiguous.
vi.mock("@/components/shamela/BookCover", () => ({
  BookCover: ({ bookId }: { bookId: number }) => <div data-testid={`cover-${bookId}`} />,
}));

const MASTER_DB = "C:/Shamela/master.db";

type ShamelaApi = Record<string, ReturnType<typeof vi.fn>>;

function installBridge(overrides: Partial<ShamelaApi> = {}) {
  const api: ShamelaApi = {
    detect: vi.fn().mockResolvedValue({ installed: true, masterDbPath: MASTER_DB }),
    listCategories: vi.fn().mockResolvedValue([
      { id: 1, name: "فقه", bookCount: 12 },
      { id: 2, name: "حديث", bookCount: 30 },
    ]),
    authors: vi.fn().mockResolvedValue([{ id: 7, name: "ابن تيمية", bookCount: 4, alpha: "ا" }]),
    searchAuthors: vi.fn().mockResolvedValue([{ id: 9, name: "ابن القيم", bookCount: 2, alpha: "ا" }]),
    periods: vi.fn().mockResolvedValue([{ century: 7, label: "القرن السابع", bookCount: 5 }]),
    booksByCategory: vi.fn().mockResolvedValue([{ id: 101, title: "كتاب الفقه", author: "مؤلف" }]),
    booksByAuthor: vi.fn().mockResolvedValue([{ id: 202, title: "كتاب المؤلف", author: "ابن تيمية" }]),
    booksByPeriod: vi.fn().mockResolvedValue([{ id: 303, title: "كتاب القرن", author: "مؤلف" }]),
    ...overrides,
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = { shamela: api };
  return api;
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe("BrowseTab — catalogue browsing state machine", () => {
  describe("detection", () => {
    it("reports the missing bridge instead of rendering an empty catalogue", async () => {
      delete (window as unknown as { electronAPI?: unknown }).electronAPI;
      render(<BrowseTab />);
      expect(await screen.findByText(/Native Shamela bridge is unavailable/i)).toBeInTheDocument();
    });

    it("reports Shamela not being installed", async () => {
      installBridge({ detect: vi.fn().mockResolvedValue({ installed: false, masterDbPath: null }) });
      render(<BrowseTab />);
      expect(await screen.findByText(/شاملہ ۴ نصب نہیں ہے/)).toBeInTheDocument();
    });

    it("surfaces a detection failure rather than hanging on the spinner", async () => {
      installBridge({ detect: vi.fn().mockRejectedValue(new Error("bridge exploded")) });
      render(<BrowseTab />);
      expect(await screen.findByText("bridge exploded")).toBeInTheDocument();
    });
  });

  describe("once connected", () => {
    let api: ShamelaApi;
    beforeEach(() => {
      api = installBridge();
    });

    it("loads categories with the detected master.db path", async () => {
      render(<BrowseTab />);
      expect(await screen.findByText("فقه")).toBeInTheDocument();
      expect(api.listCategories).toHaveBeenCalledWith(MASTER_DB);
    });

    it("loads a category's books when it is opened", async () => {
      render(<BrowseTab />);
      fireEvent.click(await screen.findByText("فقه"));
      expect(await screen.findByText("كتاب الفقه")).toBeInTheDocument();
      expect(api.booksByCategory).toHaveBeenCalledWith(MASTER_DB, 1, expect.any(Number));
    });

    it("clears the drilled-in book list when going back", async () => {
      render(<BrowseTab />);
      fireEvent.click(await screen.findByText("فقه"));
      await screen.findByText("كتاب الفقه");

      fireEvent.click(screen.getByTitle("Back to browse"));

      await waitFor(() => expect(screen.queryByText("كتاب الفقه")).not.toBeInTheDocument());
      // Back at the category list, not a blank pane.
      expect(screen.getByText("حديث")).toBeInTheDocument();
    });

    it("hands the selected book id to the caller as a string", async () => {
      const onSelectBook = vi.fn();
      const onNavigate = vi.fn();
      render(<BrowseTab onSelectBook={onSelectBook} onNavigate={onNavigate} />);
      fireEvent.click(await screen.findByText("فقه"));
      fireEvent.click(await screen.findByText("كتاب الفقه"));

      // The reader keys off string ids; passing the raw number silently misses.
      expect(onSelectBook).toHaveBeenCalledWith("101");
      expect(onNavigate).toHaveBeenCalled();
    });

    it("switches to authors and lists them unfiltered", async () => {
      render(<BrowseTab />);
      await screen.findByText("فقه");
      fireEvent.click(screen.getByText("Authors"));

      expect(await screen.findByText("ابن تيمية")).toBeInTheDocument();
      expect(api.authors).toHaveBeenCalledWith(MASTER_DB, expect.any(Number));
      expect(api.searchAuthors).not.toHaveBeenCalled();
    });

    it("uses the search endpoint once an author query is typed", async () => {
      render(<BrowseTab />);
      await screen.findByText("فقه");
      fireEvent.click(screen.getByText("Authors"));
      await screen.findByText("ابن تيمية");

      fireEvent.change(screen.getByPlaceholderText("Search authors…"), { target: { value: "قيم" } });

      await waitFor(() =>
        expect(api.searchAuthors).toHaveBeenCalledWith(MASTER_DB, "قيم", expect.any(Number)),
      );
      expect(await screen.findByText("ابن القيم")).toBeInTheDocument();
    });

    it("loads a period's books by century", async () => {
      render(<BrowseTab />);
      await screen.findByText("فقه");
      fireEvent.click(screen.getByText("Periods"));

      fireEvent.click(await screen.findByText("القرن السابع"));
      expect(await screen.findByText("كتاب القرن")).toBeInTheDocument();
      expect(api.booksByPeriod).toHaveBeenCalledWith(MASTER_DB, 7, expect.any(Number));
    });

    it("keeps only one drill-down selection at a time", async () => {
      render(<BrowseTab />);
      fireEvent.click(await screen.findByText("فقه"));
      await screen.findByText("كتاب الفقه");

      fireEvent.click(screen.getByTitle("Back to browse"));
      fireEvent.click(screen.getByText("Authors"));
      fireEvent.click(await screen.findByText("ابن تيمية"));

      // The previous category's books must not survive into the author view.
      expect(await screen.findByText("كتاب المؤلف")).toBeInTheDocument();
      expect(screen.queryByText("كتاب الفقه")).not.toBeInTheDocument();
    });

    it("surfaces a book-loading failure without wedging the loading state", async () => {
      api.booksByCategory.mockRejectedValue(new Error("db locked"));
      render(<BrowseTab />);
      fireEvent.click(await screen.findByText("فقه"));
      expect(await screen.findByText("db locked")).toBeInTheDocument();
    });
  });
});
