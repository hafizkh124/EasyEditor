import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor, render, screen, fireEvent } from "@testing-library/react";

/**
 * SYSTEM-2026 §6 — a scanned page is read (OCR) first and its text kept, so
 * it is translated and reviewed paragraph by paragraph; glossary and style
 * travel with every page; one paragraph can be re-translated with a request.
 */

const inserts: Array<Record<string, unknown>> = [];
const upserts: Array<Record<string, unknown>> = [];
let failGlossaryColumnOnce = false;

vi.mock("@/integrations/supabase/client", () => {
  const from = () => ({
    insert: (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          inserts.push(row);
          if (failGlossaryColumnOnce && "glossary" in row) {
            failGlossaryColumnOnce = false;
            return { data: null, error: { message: "Could not find the 'glossary' column" } };
          }
          return { data: { id: "proj-1" }, error: null };
        },
      }),
    }),
    upsert: async (row: Record<string, unknown>) => {
      upserts.push(row);
      return { error: null };
    },
    update: () => ({ eq: async () => ({ error: null }) }),
  });
  return { supabase: { from } };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }),
}));
vi.mock("@/hooks/useTokenBalance", () => ({ useTokenBalance: () => ({ total: 1000 }) }));
vi.mock("@/contexts/SubscriptionContext", () => ({ TOKEN_COSTS: { ocr: 15, translate: 20, translate_book: 10 } }));
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ language: "ur", t: (_k: string, f?: string) => f ?? _k }) }));
vi.mock("@/core/shamela/shamelaClient", () => ({ getShamelaClient: vi.fn() }));
vi.mock("@/lib/shamela/shamelaPdf", () => ({ getBookPdfInfo: vi.fn(), readBookPdf: vi.fn() }));

const ocrPageImage = vi.fn(async () => "الحمد لله رب\nالعالمين.\nوالصلاة على النبي.");
vi.mock("@/lib/ocr/ocrClient", () => ({ ocrPageImage: (...a: unknown[]) => ocrPageImage(...(a as [])) }));

vi.mock("@/lib/ocr/pdfRenderer", () => ({
  renderPdfPages: async function* () {
    yield { pageNum: 1, totalPages: 1, imageBase64: "IMG", mimeType: "image/jpeg" };
  },
}));

const translateOnePage = vi.fn(async (args: { text?: string }) =>
  args.text?.includes("\n\n") ? "All praise is for Allah.\n\nAnd blessings on the Prophet." : "And salah upon the Prophet.");
vi.mock("@/lib/translate/translatePageApi", () => ({
  translateOnePage: (args: { text?: string }) => translateOnePage(args),
}));

import { useBookTranslation } from "@/hooks/useBookTranslation";
import { ReviewPane, type ReviewPaneProps } from "@/components/translate/ReviewPane";
import { PARAGRAPH_RULE } from "@/lib/translate/glossary";

async function loadedBook() {
  const hook = renderHook(() => useBookTranslation());
  await act(async () => {
    await hook.result.current.loadPdf(new File(["%PDF"], "kitab.pdf", { type: "application/pdf" }));
  });
  return hook;
}

describe("useBookTranslation — read then translate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserts.length = 0;
    upserts.length = 0;
  });

  it("estimates the reading cost and time of a scanned page", async () => {
    const { result } = await loadedBook();
    const estimate = result.current.estimateBatch(1, 1);
    expect(estimate).toMatchObject({ pages: 1, pagesToRead: 1, tokenCost: 10 + 15 });
    expect(estimate.estimatedSeconds).toBeGreaterThan(3);
  });

  it("reads the page, keeps its text, and sends paragraphs with style and glossary", async () => {
    const { result } = await loadedBook();
    act(() => {
      result.current.setStyle("literal");
      result.current.setGlossary([{ source: "الصلاة", target: "Salah" }, { source: "الزكاة", target: "Zakah" }]);
    });
    await act(async () => { await result.current.translateSinglePage(1); });

    expect(ocrPageImage).toHaveBeenCalledWith("IMG", "image/jpeg");
    const sent = translateOnePage.mock.calls[0][0] as unknown as { text: string; imageBase64?: string; genreInstruction: string };
    expect(sent.text).toBe("الحمد لله رب العالمين.\n\nوالصلاة على النبي.");
    expect(sent.imageBase64).toBeUndefined();
    expect(sent.genreInstruction).toContain("literal");
    expect(sent.genreInstruction).toContain("الصلاة → Salah");
    expect(sent.genreInstruction).not.toContain("Zakah");
    expect(sent.genreInstruction).toContain(PARAGRAPH_RULE);

    const page = result.current.pages[0];
    expect(page.status).toBe("done");
    expect(page.sourceText).toContain("العالمين");
    expect(upserts.at(-1)).toMatchObject({
      chunk_index: 1, translated_text: "All praise is for Allah.\n\nAnd blessings on the Prophet.", status: "completed", reviewed: [],
    });
    // The reading was saved on its own first, so a failed translation never costs a second read.
    expect(upserts[0]).toMatchObject({ status: "read", translated_text: null });
  });

  it("re-translates one paragraph with a request and keeps the rest", async () => {
    const { result } = await loadedBook();
    await act(async () => { await result.current.translateSinglePage(1); });
    act(() => result.current.toggleReviewed(1, 0));
    act(() => result.current.toggleReviewed(1, 1));

    let ok = false;
    await act(async () => { ok = await result.current.retranslateParagraph(1, 1, "more fluent"); });
    expect(ok).toBe(true);
    const call = translateOnePage.mock.calls.at(-1)![0] as unknown as { text: string; genreInstruction: string };
    expect(call.text).toBe("والصلاة على النبي.");
    expect(call.genreInstruction).toContain("more fluent");
    expect(call.genreInstruction).toContain("And blessings on the Prophet.");
    expect(call.genreInstruction).not.toContain(PARAGRAPH_RULE);

    const page = result.current.pages[0];
    expect(page.translationText).toBe("All praise is for Allah.\n\nAnd salah upon the Prophet.");
    expect(page.reviewed).toEqual([0]);
  });

  it("edits one paragraph in place", async () => {
    const { result } = await loadedBook();
    await act(async () => { await result.current.translateSinglePage(1); });
    act(() => result.current.updateParagraph(1, 0, "Praise be to Allah."));
    expect(result.current.pages[0].translationText).toBe("Praise be to Allah.\n\nAnd blessings on the Prophet.");
  });

  it("still creates the project where the glossary column does not exist yet", async () => {
    failGlossaryColumnOnce = true;
    const { result } = await loadedBook();
    await waitFor(() => expect(result.current.projectId).toBe("proj-1"));
    expect(inserts).toHaveLength(2);
    expect(inserts[1]).not.toHaveProperty("glossary");
  });
});

describe("ReviewPane", () => {
  const props = (over: Partial<ReviewPaneProps> = {}): ReviewPaneProps => ({
    page: {
      pageNum: 1,
      sourceText: "الصلاة عماد الدين.\n\nوالزكاة طهرة.",
      translationText: "Prayer is the pillar of religion.\n\nZakah purifies.",
      status: "done",
      reviewed: [1],
    },
    currentPage: 1,
    totalPages: 3,
    onPageChange: vi.fn(),
    glossary: [{ source: "الصلاة", target: "Salah" }],
    streamingText: "",
    busy: false,
    retranslatingIndex: null,
    onTranslatePage: vi.fn(),
    onUpdateParagraph: vi.fn(),
    onToggleReviewed: vi.fn(),
    onSetPageReviewed: vi.fn(),
    onRetranslate: vi.fn(async () => true),
    ...over,
  });

  it("shows pairs, review progress and glossary misses", () => {
    render(<ReviewPane {...props()} />);
    expect(screen.getByText("Prayer is the pillar of religion.")).toBeInTheDocument();
    expect(screen.getByText("جائزہ: 1 از 2")).toBeInTheDocument();
    expect(screen.getByText(/الصلاة ← Salah/)).toBeInTheDocument();
    expect(screen.getAllByLabelText("جائزہ شدہ")).toHaveLength(1);
  });

  it("opens a pair: highlights both halves, edits in place, marks reviewed, re-translates", async () => {
    const p = props();
    render(<ReviewPane {...p} />);
    fireEvent.click(screen.getByText("الصلاة عماد الدين."));
    expect(screen.getByRole("button", { name: /پیراگراف 1 — اصل/ })).toHaveAttribute("aria-pressed", "true");

    const box = screen.getByRole("textbox", { name: /پیراگراف 1 — ترجمہ/ });
    fireEvent.change(box, { target: { value: "Salah is the pillar of religion." } });
    fireEvent.blur(box);
    expect(p.onUpdateParagraph).toHaveBeenCalledWith(0, "Salah is the pillar of religion.");

    fireEvent.click(screen.getByRole("button", { name: "جائزہ مکمل" }));
    expect(p.onToggleReviewed).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByRole("button", { name: "ہدایت کے ساتھ دوبارہ ترجمہ" }));
    fireEvent.click(screen.getByRole("button", { name: "زیادہ رواں کریں" }));
    await waitFor(() => expect(p.onRetranslate).toHaveBeenCalledWith(0, "زیادہ رواں کریں"));
  });

  it("offers to read and translate an untranslated scanned page", () => {
    const p = props({ page: { pageNum: 2, imageBase64: "IMG", translationText: "", status: "pending" }, currentPage: 2 });
    render(<ReviewPane {...p} />);
    expect(screen.getByAltText("صفحے کی تصویر")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "یہ صفحہ ترجمہ کریں" }));
    expect(p.onTranslatePage).toHaveBeenCalled();
  });
});
