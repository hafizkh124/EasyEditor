import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * SYSTEM-2026 §5 — one "extract text" screen. The kind of job is read from the
 * file; the result has "Copy all" and becomes a document in one tap.
 */

const { transcribeLongForm, resolveSttRoute, TranscribeCancelledError, ocrPageImage, getPdfPageCount, renderPdfPages } = vi.hoisted(() => {
  class TranscribeCancelledError extends Error {}
  return {
    transcribeLongForm: vi.fn(),
    resolveSttRoute: vi.fn(async () => "cloud"),
    TranscribeCancelledError,
    ocrPageImage: vi.fn(),
    getPdfPageCount: vi.fn(),
    renderPdfPages: vi.fn(),
  };
});
vi.mock("@/lib/audio/transcribeLongForm", () => ({
  transcribeLongForm: (...a: unknown[]) => transcribeLongForm(...a),
  resolveSttRoute: () => resolveSttRoute(),
  TranscribeCancelledError,
  MAX_DURATION_SECONDS: 7200,
}));
vi.mock("@/lib/ocr/ocrClient", () => ({ ocrPageImage: (...a: unknown[]) => ocrPageImage(...a) }));
vi.mock("@/lib/ocr/pdfRenderer", () => ({
  getPdfPageCount: (...a: unknown[]) => getPdfPageCount(...a),
  renderPdfPages: (...a: unknown[]) => renderPdfPages(...a),
}));

let canAfford = true;
let currentUser: { id: string } | null = { id: "u1" };
vi.mock("@/hooks/useTokenBalance", () => ({ useCanAfford: () => ({ canAfford }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: currentUser, session: { access_token: "tok" } }) }));
const stableT = (k: string, fb?: string) => fb ?? k;
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ t: stableT, direction: "rtl", language: "ur" }) }));
vi.mock("@/hooks/useSeo", () => ({ useSeo: () => {} }));
const save = vi.fn();
const reset = vi.fn();
vi.mock("@/hooks/usePageSession", () => ({ usePageSession: () => ({ save, reset, currentId: null }) }));
vi.mock("@/lib/activityLog", () => ({ logActivity: vi.fn() }));
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/workspace/SaveToLibraryButton", () => ({ SaveToLibraryButton: () => null }));
vi.mock("@/components/TokenCostBadge", () => ({ default: () => null }));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import Extract from "@/pages/Extract";
import { detectKind } from "@/pages/extract/useExtract";

let landed: { pathname: string; state: unknown } | null = null;
function Probe() {
  const loc = useLocation();
  landed = { pathname: loc.pathname, state: loc.state };
  return null;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/extract"]}>
      <Routes>
        <Route path="/extract" element={<Extract />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const fileInput = () => document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
const drop = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });

describe("detectKind", () => {
  it("reads the job from the file", () => {
    expect(detectKind(new File(["x"], "bayan.m4a", { type: "audio/mp4" }))).toBe("audio");
    expect(detectKind(new File(["x"], "clip.mp4", { type: "video/mp4" }))).toBe("audio");
    expect(detectKind(new File(["x"], "voice.opus", { type: "" }))).toBe("audio");
    expect(detectKind(new File(["x"], "page.jpg", { type: "image/jpeg" }))).toBe("image");
    expect(detectKind(new File(["x"], "fatawa.pdf", { type: "application/pdf" }))).toBe("pdf");
    expect(detectKind(new File(["x"], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))).toBeNull();
  });
});

describe("Extract page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canAfford = true;
    currentUser = { id: "u1" };
    landed = null;
    localStorage.clear();
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.unstubAllEnvs();
  });

  it("transcribes audio, saves the result, and copies all with one tap", async () => {
    transcribeLongForm.mockResolvedValue({ text: "بسم اللہ", chunkCount: 1, segments: null });
    renderPage();
    drop(new File(["a"], "bayan.m4a", { type: "audio/mp4" }));
    expect(await screen.findByDisplayValue("بسم اللہ")).toBeInTheDocument();
    expect(transcribeLongForm.mock.calls[0][0]).toMatchObject({ language: "auto", route: "cloud" });
    expect(save).toHaveBeenCalledWith({ title: "بسم اللہ", metadata: expect.objectContaining({ transcript: "بسم اللہ" }) });
    // A new extraction never overwrites the previous saved result.
    expect(reset).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /سب کاپی کریں/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("بسم اللہ"));
  });

  it("reads every page of a PDF, in order, with page markers", async () => {
    getPdfPageCount.mockResolvedValue(2);
    renderPdfPages.mockImplementation(async function* () {
      yield { pageNum: 1, totalPages: 2, imageBase64: "a", mimeType: "image/jpeg" };
      yield { pageNum: 2, totalPages: 2, imageBase64: "b", mimeType: "image/jpeg" };
    });
    ocrPageImage.mockResolvedValueOnce("پہلا").mockResolvedValueOnce("دوسرا");
    renderPage();
    drop(new File(["%PDF"], "fatawa.pdf", { type: "application/pdf" }));
    const box = (await screen.findByDisplayValue(/دوسرا/)) as HTMLTextAreaElement;
    expect(box.value).toBe("--- صفحہ 1 ---\nپہلا\n\n--- صفحہ 2 ---\nدوسرا");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ metadata: { extractedText: box.value } }));
  });

  it("refuses an unreadable kind of file", () => {
    renderPage();
    drop(new File(["x"], "notes.docx", { type: "application/msword" }));
    expect(toast.error).toHaveBeenCalledWith("extract.unsupported");
    expect(transcribeLongForm).not.toHaveBeenCalled();
  });

  it("does not start a paid job without the tokens for it", () => {
    canAfford = false;
    renderPage();
    drop(new File(["a"], "bayan.m4a", { type: "audio/mp4" }));
    expect(toast.error).toHaveBeenCalledWith("extract.limit_reached");
    expect(transcribeLongForm).not.toHaveBeenCalled();
  });

  it("runs local Whisper on the desktop without a token gate", async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true };
    vi.stubEnv("VITE_LOCAL_VOICE", "true");
    resolveSttRoute.mockResolvedValueOnce("local");
    canAfford = false;
    transcribeLongForm.mockResolvedValue({ text: "مقامی", chunkCount: 1 });
    renderPage();
    await waitFor(() => expect(screen.getByText("مقامی Whisper — مفت")).toBeInTheDocument());
    // OCR is cloud-only, so the desktop offers no camera.
    expect(screen.queryByRole("button", { name: /تصویر کھینچیں/ })).not.toBeInTheDocument();
    drop(new File(["a"], "bayan.m4a", { type: "audio/mp4" }));
    await screen.findByDisplayValue("مقامی");
    expect(transcribeLongForm.mock.calls[0][0]).toMatchObject({ route: "local" });
  });

  it("copies automatically when the switch is on", async () => {
    localStorage.setItem("ocr-autocopy", "true"); // the old page's setting carries over
    ocrPageImage.mockResolvedValue("متن");
    renderPage();
    drop(new File(["x"], "page.png", { type: "image/png" }));
    await screen.findByDisplayValue("متن");
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("متن"));
  });

  it("makes a document from the result", async () => {
    ocrPageImage.mockResolvedValue("فتویٰ کا متن");
    renderPage();
    drop(new File(["x"], "page.png", { type: "image/png" }));
    await screen.findByDisplayValue("فتویٰ کا متن");
    fireEvent.click(screen.getByRole("button", { name: /دستاویز بنائیں/ }));
    expect(landed).toEqual({ pathname: "/workspace", state: { content: "فتویٰ کا متن", source: "ocr", projectId: undefined } });
  });

  it("asks a signed-out user to sign in before reading pages", () => {
    currentUser = null;
    renderPage();
    drop(new File(["x"], "page.png", { type: "image/png" }));
    expect(toast.error).toHaveBeenCalledWith("extract.sign_in_for_pages");
    expect(ocrPageImage).not.toHaveBeenCalled();
  });
});
