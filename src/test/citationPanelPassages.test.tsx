import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CitationPanel from "@/components/research/CitationPanel";
import { passageClipboardText } from "@/lib/citations/passageText";
import { passageForClient, CLIENT_PASSAGE_MAX_CHARS } from "../../supabase/functions/islamic-search/index";

vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ language: "ur", t: (_k: string, f?: string) => f ?? _k }) }));

const t = ((_k: string, fallback?: string) => fallback ?? _k) as never;
const item = {
  domain: "hadith-json",
  citation_ref: { collection: "bukhari", hadith_number: "1" },
  url: "https://example.org/b1",
  content: "إنما الأعمال بالنيات",
};

describe("CitationPanel passages (search-quality phase 1.2)", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("shows the retrieved passage, numbered, without any click", () => {
    render(<CitationPanel citations={[item]} t={t} />);
    expect(screen.getByText("إنما الأعمال بالنيات")).toBeTruthy();
    expect(screen.getByText("[1]")).toBeTruthy();
  });

  it("copies passage + reference + link", async () => {
    render(<CitationPanel citations={[item]} t={t} />);
    fireEvent.click(screen.getByRole("button", { name: /کاپی/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(copied).toContain("إنما الأعمال بالنيات");
    expect(copied).toContain("https://example.org/b1");
    expect(copied).toBe(passageClipboardText(item));
  });

  it("stays collapsed (badges only) when no passage text is available", () => {
    render(<CitationPanel citations={[{ ...item, content: undefined }]} t={t} />);
    expect(screen.queryByText("إنما الأعمال بالنيات")).toBeNull();
  });
});

describe("passageForClient", () => {
  it("drops empty / non-string content", () => {
    expect(passageForClient("   ")).toBeUndefined();
    expect(passageForClient(null)).toBeUndefined();
  });
  it("truncates long passages with an ellipsis", () => {
    const out = passageForClient("ا".repeat(CLIENT_PASSAGE_MAX_CHARS + 500))!;
    expect(out.length).toBeLessThanOrEqual(CLIENT_PASSAGE_MAX_CHARS + 1);
    expect(out.endsWith("…")).toBe(true);
  });
});
