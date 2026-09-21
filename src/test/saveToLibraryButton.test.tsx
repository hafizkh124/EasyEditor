import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Same token gate as the upload dialog: desktop has no token wallet (registry `tokens.meter`
// is desktop:never), so a permanent balance of 0 must not block saving to the library.

const balance = vi.hoisted(() => ({ total: 0 }));
vi.mock("@/hooks/useTokenBalance", () => ({ useTokenBalance: () => ({ total: balance.total }) }));
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ t: (_k: string, f: string) => f, direction: "ltr" }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/i18n", () => ({
  translateStored: (key: string) => key,
  translateStoredFormat: (key: string, vars: Record<string, unknown>) => `${key} ${JSON.stringify(vars)}`,
}));
const upload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/corpus/libraryChunkService", () => ({ libraryChunkService: { uploadLibraryFile: upload } }));
const ingest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/corpus/ingestOrchestrator", () => ({ runLibraryIngest: ingest }));

import { SaveToLibraryButton } from "@/components/workspace/SaveToLibraryButton";

const asDesktop = () => {
  (globalThis as { window?: unknown }).window = globalThis.window ?? {};
  (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true };
};
const renderButton = () => render(<SaveToLibraryButton text={"نص مطلوب حفظه ".repeat(50)} title="عنوان" kind="ocr" />);

beforeEach(() => {
  vi.clearAllMocks();
  balance.total = 0;
  upload.mockResolvedValue({ id: "item-1" });
  ingest.mockResolvedValue({ done: true, inserted: 1 });
});
afterEach(() => { delete (window as unknown as { electronAPI?: unknown }).electronAPI; });

describe("SaveToLibraryButton — token gate", () => {
  it("REGRESSION desktop: saves with a zero balance instead of raising 'insufficient tokens'", async () => {
    asDesktop();
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("desktop: does not advertise a token cost in the tooltip", () => {
    asDesktop();
    renderButton();
    expect(screen.getByRole("button", { name: "Save to library" })).toHaveAttribute("title", "Save to library");
  });

  it("web: an insufficient balance still blocks the save", () => {
    balance.total = 1;
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    expect(upload).not.toHaveBeenCalled();
    expect(String(toast.error.mock.calls[0][0])).toContain("toast.tokens.insufficient");
  });

  it("web: advertises the token cost and saves once the balance covers it", async () => {
    balance.total = 1000;
    renderButton();
    expect(screen.getByRole("button", { name: "Save to library" }).getAttribute("title")).toMatch(/tokens/);
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  });
});
