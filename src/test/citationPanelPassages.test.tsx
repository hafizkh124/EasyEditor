import { readFileSync } from "node:fs";
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

describe("Arabic matn first (search-quality phase 2.6)", () => {
  const both = {
    domain: "hadith-json",
    citation_ref: { collection: "bukhari", hadith_number: "6406" },
    content: "ہم سے زہیر بن حرب نے بیان کیا",
    content_ar: "كَلِمَتانِ خَفيفَتانِ على اللِّسانِ",
  };

  it("shows the Arabic matn and puts the translation under it", () => {
    render(<CitationPanel citations={[both]} t={t} />);
    const arabic = screen.getByText("كَلِمَتانِ خَفيفَتانِ على اللِّسانِ").closest("p")!;
    const urdu = screen.getByText("ہم سے زہیر بن حرب نے بیان کیا").closest("p")!;
    expect(arabic.getAttribute("dir")).toBe("rtl");
    // Arabic precedes the translation in document order
    expect(arabic.compareDocumentPosition(urdu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not repeat a passage whose content equals its content_ar", () => {
    render(<CitationPanel citations={[{ ...both, content: both.content_ar }]} t={t} />);
    expect(screen.getAllByText(both.content_ar)).toHaveLength(1);
  });

  it("copies Arabic first, then translation, reference and link", () => {
    const out = passageClipboardText({ ...both, url: "https://example.org/b" });
    expect(out.indexOf(both.content_ar)).toBeLessThan(out.indexOf(both.content));
    expect(out).toContain("https://example.org/b");
  });

  it("a row with only Arabic (live-API tiers) still renders", () => {
    render(<CitationPanel citations={[{ domain: "dorar", citation_ref: { book: "x" }, content: both.content_ar }]} t={t} />);
    expect(screen.getByText(both.content_ar)).toBeTruthy();
  });
});

describe("search words are marked in the passage (search-quality phase 2.9)", () => {
  const cite = {
    domain: "hadith-json",
    citation_ref: { collection: "bukhari", hadith_number: "6406" },
    content_ar: "كَلِمَتانِ خَفيفَتانِ على اللِّسانِ ثَقيلَتانِ في الميزانِ",
  };

  it("marks the query words, diacritics and all, and leaves the rest alone", () => {
    const { container } = render(<CitationPanel citations={[cite]} query="كلمتان خفيفتان" t={t} />);
    const marks = [...container.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual(["كَلِمَتانِ", "خَفيفَتانِ"]);
  });

  it("marks nothing for an Urdu question or when no query is given", () => {
    expect(render(<CitationPanel citations={[cite]} query="پڑوسی کے حقوق" t={t} />).container.querySelectorAll("mark")).toHaveLength(0);
    expect(render(<CitationPanel citations={[cite]} t={t} />).container.querySelectorAll("mark")).toHaveLength(0);
  });
});

describe("long references stay inside the card (search-quality phase 2.12)", () => {
  it("wraps the reference chip and stops the scroll area from growing to its widest child", () => {
    const src = readFileSync("src/components/research/CitationPanel.tsx", "utf8");
    expect(src).toContain("[&>*]:!whitespace-normal");
    expect(src).toContain("[&_[data-radix-scroll-area-viewport]>div]:!block");
  });
});
