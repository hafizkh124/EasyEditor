import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * SPEC-M8 P6 — the "citations → Word footnotes" dialog. What must hold: the
 * marker count is computed from the document (only in-range [N]), Export
 * hands the VERIFIED sources array to the bridge (not document reference
 * text), the result summary surfaces markers-not-found / no-source, and the
 * button is disabled when there is nothing to insert.
 */
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    language: "ur", setLanguage: vi.fn(), direction: "rtl",
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { CitationFootnotesDialog } from "@/components/editor/CitationFootnotesDialog";
import type { TaskRunSource } from "@/core/workspace/types";

const sources: TaskRunSource[] = [
  { domain: "hadith", reference: "Sahih Bukhari #1", source_url: "https://x/1" },
  { domain: "hadith", reference: "Sahih Muslim #2", source_url: null },
];

function mockBridge(applyImpl?: (...a: unknown[]) => unknown) {
  const applyCitations = vi.fn(applyImpl ?? (async () => ({
    cancelled: false as const, outputPath: "C:\\out\\cited.docx", applied: 2, notFound: [], unresolved: [], ms: 10,
  })));
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    isDesktop: true,
    docBridge: { applyCitations, openPath: vi.fn(async () => ({ opened: true })) },
  };
  return applyCitations;
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.clearAllMocks();
});

const props = { open: true, onOpenChange: vi.fn(), title: "Paper" };

describe("CitationFootnotesDialog", () => {
  it("counts only in-range [N] markers", () => {
    mockBridge();
    render(<CitationFootnotesDialog {...props} html="<p>a</p>" text="a [1] b [2] c [9]" sources={sources} />);
    // "2 markers · 2 verified sources" — [9] is out of range and not counted
    expect(screen.getByText("2 markers · 2 verified sources")).toBeInTheDocument();
  });

  it("disables Export and warns when no markers are present", () => {
    mockBridge();
    render(<CitationFootnotesDialog {...props} html="<p>x</p>" text="no markers here" sources={sources} />);
    expect(screen.getByText("No [N] markers found in the document.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export to Word" })).toBeDisabled();
  });

  it("Export sends the verified sources array (reference + url), not document text", async () => {
    const apply = mockBridge();
    render(<CitationFootnotesDialog {...props} html="<p>a [1] b [2]</p>" text="a [1] b [2]" sources={sources} />);
    fireEvent.click(screen.getByRole("button", { name: "Export to Word" }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    const [html, text, passedSources] = apply.mock.calls[0];
    expect(html).toBe("<p>a [1] b [2]</p>");
    expect(text).toBe("a [1] b [2]");
    expect(passedSources).toEqual([
      { reference: "Sahih Bukhari #1", source_url: "https://x/1" },
      { reference: "Sahih Muslim #2", source_url: null },
    ]);
  });

  it("shows a result summary with markers not found / no source", async () => {
    mockBridge(async () => ({
      cancelled: false as const, outputPath: "C:\\out\\cited.docx",
      applied: 1, notFound: ["[2]"], unresolved: [5], ms: 9,
    }));
    render(<CitationFootnotesDialog {...props} html="<p>[1] [2] [5]</p>" text="[1] [2] [5]" sources={sources} />);
    fireEvent.click(screen.getByRole("button", { name: "Export to Word" }));
    expect(await screen.findByText("1 footnotes inserted")).toBeInTheDocument();
    expect(screen.getByText(/Markers not found: \[2\]/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open file" })).toBeInTheDocument();
  });

  it("a cancelled save dialog returns to the form", async () => {
    mockBridge(async () => ({ cancelled: true as const }));
    render(<CitationFootnotesDialog {...props} html="<p>[1]</p>" text="[1]" sources={sources} />);
    fireEvent.click(screen.getByRole("button", { name: "Export to Word" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Export to Word" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Open file" })).not.toBeInTheDocument();
  });
});
