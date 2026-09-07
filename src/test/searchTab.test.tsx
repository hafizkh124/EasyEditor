import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SearchTab } from "@/components/workspace/SearchTab";

/**
 * M10 Phase 2.3 — SearchTab's plain search ALREADY routes through the web
 * bridge (searchShamelaAsChunks, added 2026-08-16, commit 9f57383) — an older
 * comment in useShamelaAvailability.ts claimed this tab stayed desktop-only,
 * which was stale by the time this session found it. These tests pin the
 * corrected understanding: plain search works on plain web (no
 * window.electronAPI at all), and root search degrades to empty (not a
 * crash) without a native S2.db.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, direction: "rtl", language: "ur" }),
}));

const searchChunksByRootMock = vi.fn();
vi.mock("@/core/workspace/libraryItemService", () => ({
  libraryItemService: { searchChunksByRoot: (...args: unknown[]) => searchChunksByRootMock(...args) },
}));

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  searchChunksByRootMock.mockReset().mockResolvedValue([]);
});

describe("SearchTab — on plain web (no window.electronAPI at all)", () => {
  it("searches via the bridge and renders results, without desktop APIs", async () => {
    localStorage.setItem("shamela.connected", "1");
    localStorage.setItem("shamela.mcp_url", "http://127.0.0.1:8000");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok", total_hits: 1,
        results: [{ book_id: 5, book_name: "صحيح البخاري", author_name: "البخاري", volume: null, page: 12, content: "نص الحديث عن النية", highlighted: null }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SearchTab />);
    fireEvent.change(screen.getByPlaceholderText(/Search imported books/i), { target: { value: "نية" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));

    await waitFor(() => expect(screen.getByText("صحيح البخاري")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/search"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the real 'no results' state (not desktop-only) when the bridge answers empty", async () => {
    localStorage.setItem("shamela.connected", "1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: "ok", total_hits: 0, results: [] }),
    }));

    render(<SearchTab />);
    fireEvent.change(screen.getByPlaceholderText(/Search imported books/i), { target: { value: "xyz" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "No results" })).toBeInTheDocument());
  });

  it("has no results at all when the bridge was never connected — still no crash", async () => {
    // localStorage["shamela.connected"] absent entirely.
    render(<SearchTab />);
    fireEvent.change(screen.getByPlaceholderText(/Search imported books/i), { target: { value: "نية" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "No results" })).toBeInTheDocument());
  });

  it("root search stays a no-op (empty results), never a crash, with no native S2.db", async () => {
    render(<SearchTab />);
    fireEvent.change(screen.getByPlaceholderText(/Search imported books/i), { target: { value: "كتب" } });
    fireEvent.click(screen.getByRole("button", { name: /Root search/i }));
    await waitFor(() => expect(searchChunksByRootMock).toHaveBeenCalledWith(null, "كتب", 100));
    expect(screen.getByText("No results for any form of this root. Try a different word.")).toBeInTheDocument();
  });
});
