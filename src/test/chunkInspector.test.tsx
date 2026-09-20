import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChunkInspectorDialog } from "@/components/workspace/ChunkInspectorDialog";
import { libraryChunkService } from "@/lib/corpus/libraryChunkService";
import type { LibraryItem } from "@/core/workspace/types";
import type { LibraryChunkInfo } from "@/core/backend/types";

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_k: string, f: string) => f }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("ChunkInspectorDialog", () => {
  const mockItem: LibraryItem = {
    id: "item-123",
    user_id: "user-123",
    title: "صحیح البخاری - کتاب الإیمان",
    kind: "book",
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    meta: {
      ingest: {
        chunker: "adaptive-v1",
        total_chunks: 2,
        status: "ready",
      },
    },
  };

  const mockChunks: LibraryChunkInfo[] = [
    {
      id: "chunk-1",
      chunk_index: 0,
      content: "حدثنا عبد الله بن يوسف قال أخبرنا مالك عن هشام بن عروة عن أبيه عن عائشة أم المؤمنين",
      char_start: 0,
      char_end: 86,
      meta: {
        kind: "hadith",
        isnad: "حدثنا عبد الله بن يوسف قال أخبرنا مالك",
        heading: "باب كيف كان بدء الوحي إلى رسول الله",
      },
    },
    {
      id: "chunk-2",
      chunk_index: 1,
      content: "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى",
      char_start: 87,
      char_end: 130,
      meta: {
        kind: "fiqh",
        heading: "باب ما جاء أن الأعمال بالنية والحسبة",
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and displays chunks when dialog is opened", async () => {
    vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce(mockChunks);

    render(
      <ChunkInspectorDialog
        item={mockItem}
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    expect(screen.getByText("صحیح البخاری - کتاب الإیمان")).toBeInTheDocument();
    expect(screen.getByText("Adaptive v1 (ساختی)")).toBeInTheDocument();

    await waitFor(() => {
      expect(libraryChunkService.listChunks).toHaveBeenCalledWith("item-123", 500);
    });

    const matches = await screen.findAllByText(/حدثنا عبد الله بن يوسف/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/إنما الأعمال بالنيات/)).toBeInTheDocument();
    expect(screen.getByText(/سند:/)).toBeInTheDocument();
    expect(screen.getByText("باب كيف كان بدء الوحي إلى رسول الله")).toBeInTheDocument();
  });

  it("filters chunks based on search query", async () => {
    vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce(mockChunks);

    render(
      <ChunkInspectorDialog
        item={mockItem}
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText(/حدثنا عبد الله بن يوسف/).length).toBeGreaterThanOrEqual(1);
    });

    const searchInput = screen.getByPlaceholderText("چنک کے متن، انڈیکس یا باب میں تلاش کریں...");
    fireEvent.change(searchInput, { target: { value: "بالنيات" } });

    expect(screen.queryAllByText(/حدثنا عبد الله بن يوسف/)).toHaveLength(0);
    expect(screen.getByText(/إنما الأعمال بالنيات/)).toBeInTheDocument();
  });

  it("handles empty chunk list gracefully", async () => {
    vi.spyOn(libraryChunkService, "listChunks").mockResolvedValueOnce([]);

    render(
      <ChunkInspectorDialog
        item={mockItem}
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("اس دستاویز کا کوئی چنک موجود نہیں ہے۔")).toBeInTheDocument();
    });
  });
});
