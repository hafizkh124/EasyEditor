import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readerService } from "@/core/workspace/readerService";
import { FavoritesTab } from "@/components/workspace/FavoritesTab";

/**
 * M10 Phase 2.3 — FavoritesTab was never bridge-bound: it only ever reads
 * `readerService` (the cloud/local backend facade), so it already works on
 * plain web (no window.electronAPI at all). An older comment elsewhere
 * claimed it stayed desktop-only; these tests pin the corrected
 * understanding directly against this component.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, direction: "rtl", language: "ur" }),
}));

// No text here — FavoritesTab's own <p> already prints the title, and a
// second copy makes every getByText on a book ambiguous (browseTab.test.tsx's
// own fix for the identical issue).
vi.mock("@/components/shamela/BookCover", () => ({
  BookCover: ({ bookId }: { bookId: string }) => <div data-testid={`cover-${bookId}`} />,
}));

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(readerService, "listReadingProgress").mockResolvedValue([]);
});

describe("FavoritesTab — on plain web (no window.electronAPI at all)", () => {
  it("lists favorites straight from readerService, no desktop API involved", async () => {
    vi.spyOn(readerService, "listFavorites").mockResolvedValue([
      { bookId: "5", title: "صحيح البخاري", author: "البخاري", createdAt: "2026-01-01" },
    ]);
    render(<FavoritesTab />);
    await waitFor(() => expect(screen.getByText("صحيح البخاري")).toBeInTheDocument());
  });

  it("shows reading progress alongside a favorite when it exists", async () => {
    vi.spyOn(readerService, "listFavorites").mockResolvedValue([
      { bookId: "5", title: "صحيح البخاري", author: null, createdAt: "2026-01-01" },
    ]);
    vi.spyOn(readerService, "listReadingProgress").mockResolvedValue([
      { bookId: "5", pageNumber: 40, pageCount: 200, updatedAt: "2026-01-02" },
    ]);
    render(<FavoritesTab />);
    await waitFor(() => expect(screen.getByText(/40/)).toBeInTheDocument());
  });

  it("shows the real empty state (not a desktop-only message) with no favorites", async () => {
    vi.spyOn(readerService, "listFavorites").mockResolvedValue([]);
    render(<FavoritesTab />);
    await waitFor(() => expect(screen.getByText(/No favorites yet/i)).toBeInTheDocument());
  });

  it("removes a favorite via readerService.removeFavorite, no crash without electronAPI", async () => {
    const removeSpy = vi.spyOn(readerService, "removeFavorite").mockResolvedValue(true);
    vi.spyOn(readerService, "listFavorites").mockResolvedValue([
      { bookId: "5", title: "صحيح البخاري", author: null, createdAt: "2026-01-01" },
    ]);
    render(<FavoritesTab />);
    await waitFor(() => expect(screen.getByText("صحيح البخاري")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle(/Remove from favorites/i));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("5"));
    await waitFor(() => expect(screen.queryByText("صحيح البخاري")).not.toBeInTheDocument());
  });
});
