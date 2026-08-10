import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The OCR page's state machine, pinned before it is refactored.
 *
 * 16 `useState`s drive one flow: validate a dropped file → branch to image or
 * PDF mode → optionally crop → extract → publish text, copy it, log it. The
 * assertions here are about the decisions in that flow — which files are
 * refused, which mode a file selects, what gates extraction, and how a failed
 * extraction is reported — not about the markup that displays them.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: () => Promise.resolve({ error: null }),
    }),
  },
}));

const getPdfPageCount = vi.fn();
// `handleExtract` drives this with `for await`, so it has to be a real async
// iterable — a resolved array would throw before any OCR call happened and the
// error-mapping assertions below would pass for the wrong reason.
const pdfPages = vi.fn();
vi.mock("@/lib/ocr/pdfRenderer", () => ({
  getPdfPageCount: (...a: unknown[]) => getPdfPageCount(...a),
  renderPdfPages: async function* (...a: unknown[]) {
    yield* pdfPages(...a);
  },
}));

let canAfford = true;
vi.mock("@/hooks/useTokenBalance", () => ({
  useCanAfford: () => ({ canAfford: canAfford }),
  useTokenBalance: () => ({ balance: 1000, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useLimitReached", () => ({
  useLimitReached: () => ({ used: 0, limit: 100, reached: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@b.c" }, session: { access_token: "tok" } }),
}));
vi.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ subscription: { tier: "pro" }, refetch: vi.fn() }),
}));
// The page interpolates counts itself via `t(key).replace("{n}", …)`, so the
// two keys carrying that placeholder must come back as templates — returning a
// bare key would make the substitution silently a no-op and hide the bug.
const TEMPLATES: Record<string, string> = {
  "ocr.pdf_page_limit": "At most {n} pages",
  "ocr.pdf_loaded": "Loaded {n} pages",
  "ocr.pdf_success": "Extracted {n} pages",
};
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (k: string) => TEMPLATES[k] ?? k,
    direction: "rtl",
    language: "ur",
  }),
}));
vi.mock("@/hooks/useSeo", () => ({ useSeo: () => {} }));
// The real hook returns { save, reset, currentId }; the page destructures
// `save` as `saveSession`. Getting this shape wrong throws inside the success
// path, which is caught and reported as a generic failure.
vi.mock("@/hooks/usePageSession", () => ({
  usePageSession: () => ({ save: vi.fn(), reset: vi.fn(), currentId: null }),
}));
vi.mock("@/lib/activityLog", () => ({ logActivity: vi.fn(), getRecentActivity: vi.fn() }));
// The real shell renders the whole nav; this suite is about the page's logic.
vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/workspace/SaveToLibraryButton", () => ({ SaveToLibraryButton: () => null }));
vi.mock("@/components/TokenCostBadge", () => ({ default: () => null }));

const toastError = vi.fn();
const toastInfo = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

import OCR from "@/pages/OCR";
import { MAX_PDF_PAGES } from "@/lib/ocr/documentFormats";

function renderOcr() {
  return render(<MemoryRouter><OCR /></MemoryRouter>);
}

/** The page renders separate extract controls for image and PDF mode. */
function enabledExtractButton(): HTMLButtonElement | undefined {
  return screen
    .queryAllByRole("button", { name: /ocr\.extract/i })
    .find((b) => !(b as HTMLButtonElement).disabled) as HTMLButtonElement | undefined;
}

/** The hidden <input type="file"> the dropzone and the button both feed. */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  if (!input) throw new Error("OCR page rendered without a file input");
  return input;
}

function drop(file: File) {
  fireEvent.change(fileInput(), { target: { files: [file] } });
}

function makeFile(name: string, type: string, size: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

/** OCR talks to the edge function through raw `fetch`, not the Supabase client. */
const fetchMock = vi.fn();

beforeEach(() => {
  canAfford = true;
  vi.clearAllMocks();
  getPdfPageCount.mockResolvedValue(3);
  pdfPages.mockReturnValue([
    { pageNum: 1, imageBase64: "AAA", mimeType: "image/png" },
  ]);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ text: "استخراج شدہ متن" }),
  });
  vi.stubGlobal("fetch", fetchMock);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("OCR page — intake validation", () => {
  it("refuses a file type it cannot read", async () => {
    renderOcr();
    drop(makeFile("notes.txt", "text/plain", 1024));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("ocr.invalid_file"));
    expect(getPdfPageCount).not.toHaveBeenCalled();
  });

  it("refuses a file over the size limit before doing any work", async () => {
    renderOcr();
    drop(makeFile("huge.jpg", "image/jpeg", 500 * 1024 * 1024));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("ocr.file_too_large"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a PDF with more pages than the cap, naming the cap", async () => {
    getPdfPageCount.mockResolvedValue(MAX_PDF_PAGES + 1);
    renderOcr();
    drop(makeFile("book.pdf", "application/pdf", 1024));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining(String(MAX_PDF_PAGES))),
    );
  });

  it("reports a PDF it cannot open rather than entering PDF mode", async () => {
    getPdfPageCount.mockRejectedValue(new Error("corrupt"));
    renderOcr();
    drop(makeFile("bad.pdf", "application/pdf", 1024));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("ocr.error"));
  });

  it("enters PDF mode and reports the page count for a readable PDF", async () => {
    renderOcr();
    drop(makeFile("book.pdf", "application/pdf", 1024));
    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining("3")),
    );
  });
});

describe("OCR page — extraction", () => {
  async function loadPdfAndExtract() {
    renderOcr();
    drop(makeFile("book.pdf", "application/pdf", 1024));
    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    const extract = enabledExtractButton();
    expect(extract, "no enabled extract control after loading a PDF").toBeTruthy();
    fireEvent.click(extract!);
  }

  it("extracts the page text and reports the page count", async () => {
    await loadPdfAndExtract();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByDisplayValue(/استخراج شدہ متن/)).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("3"));
  });

  it("offers no way to spend a request the balance cannot cover", async () => {
    canAfford = false;
    renderOcr();
    drop(makeFile("book.pdf", "application/pdf", 1024));
    await waitFor(() => expect(toastInfo).toHaveBeenCalled());

    // The control is disabled rather than failing on click, so there is nothing
    // to press and nothing reaches the edge function.
    expect(enabledExtractButton()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a 429 to the limit message, not a generic error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await loadPdfAndExtract();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("ocr.limit_reached"));
  });

  it("reports other failures generically", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
    await loadPdfAndExtract();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("ocr.error"));
  });

  it("says so when a page yields no text instead of claiming success", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ text: "   " }) });
    await loadPdfAndExtract();
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith("ocr.no_text_found"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("OCR page — auto-copy preference", () => {
  it("reads the stored preference on mount", () => {
    localStorage.setItem("ocr-autocopy", "true");
    renderOcr();
    const toggle = document.querySelector('[role="switch"]');
    expect(toggle).toHaveAttribute("data-state", "checked");
  });

  it("defaults to off when nothing is stored", () => {
    renderOcr();
    const toggle = document.querySelector('[role="switch"]');
    expect(toggle).toHaveAttribute("data-state", "unchecked");
  });
});
