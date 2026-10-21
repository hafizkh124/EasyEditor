import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/** SYSTEM-2026 §3 — pinning sources to a folder. */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string, fallback?: string) => fallback ?? key, direction: "rtl" }),
}));
vi.mock("@/lib/sources/searchSources", () => ({
  searchSources: vi.fn(async () => [
    { ref: "shamela:77", label: "بدائع الصنائع", sublabel: "الكاساني" },
    { ref: "shamela:12", label: "رد المحتار" },
  ]),
}));
const updateProject = vi.fn(async () => ({}));
vi.mock("@/core/workspace/documentService", () => ({
  documentService: { updateProject: (...a: unknown[]) => updateProject(...(a as [])) },
}));

import { PinSourcesDialog } from "@/components/workspace/PinSourcesDialog";

const project = { id: "p1", user_id: "u", title: "فتاویٰ", kind: "general" as const, status: "active", created_at: "", updated_at: "", meta: { other: 1, pinnedSources: [{ ref: "shamela:12", label: "رد المحتار" }] } };

describe("PinSourcesDialog", () => {
  it("searches, pins a new book, keeps the folder's other meta, and saves", async () => {
    const onSaved = vi.fn();
    render(<PinSourcesDialog project={project} onOpenChange={() => {}} onSaved={onSaved} />);
    // Already pinned books are listed (and not repeated in the search results).
    expect(screen.getByRole("button", { name: /رد المحتار/, pressed: true })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "بدائع" } });
    fireEvent.click(await screen.findByRole("button", { name: /بدائع الصنائع/, pressed: false }));
    fireEvent.click(screen.getByRole("button", { name: "محفوظ کریں" }));
    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith("p1", {
        meta: {
          other: 1,
          pinnedSources: [
            { ref: "shamela:12", label: "رد المحتار" },
            { ref: "shamela:77", label: "بدائع الصنائع", sublabel: "الكاساني" },
          ],
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
