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
vi.mock("@/hooks/usePageSession", () => ({ usePageSession: () => ({ save: vi.fn(), reset: vi.fn(), currentId: null }) }));
// The job saves its own result (SYSTEM-2026 §9), whether or not this screen is still open.
const upsertUserSession = vi.hoisted(() => vi.fn(async () => "sess-1"));
vi.mock("@/lib/userSessions", () => ({ upsertUserSession }));
vi.mock("@/lib/activityLog", () => ({ logActivity: vi.fn() }));
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/workspace/SaveToLibraryButton", () => ({ SaveToLibraryButton: () => null }));
vi.mock("@/components/TokenCostBadge", () => ({ default: () => null }));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const takeSharedFile = vi.hoisted(() => vi.fn(async () => null as File | null));
vi.mock("@/lib/extract/sharedFile", () => ({ takeSharedFile }));

import Extract from "@/pages/Extract";
import { detectKind } from "@/pages/extract/useExtract";

let landed: { pathname: string; state: unknown } | null = null;
function Probe() {
  const loc = useLocation();
  landed = { pathname: loc.pathname, state: loc.state };
  return null;
}

function renderPage(path = "/extract") {
  return render(
    <MemoryRouter initialEntries={[path]}>
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
    // jsdom has no object URLs; the page makes one for the recording.
    URL.createObjectURL = vi.fn(() => "blob:recording");
    URL.revokeObjectURL = vi.fn();
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
    // Each extraction is a new saved result, never an overwrite of the last one.
    await waitFor(() =>
      expect(upsertUserSession).toHaveBeenCalledWith(expect.objectContaining({
        id: null, userId: "u1", section: "transcribe", title: "بسم اللہ", metadata: expect.objectContaining({ transcript: "بسم اللہ" }),
      })),
    );
    fireEvent.click(screen.getByRole("button", { name: /سب کاپی کریں/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("بسم اللہ"));
  });

  it("opens an audio result as a read-along with its recording, and Edit shows the text", async () => {
    transcribeLongForm.mockResolvedValue({
      text: "پہلا حصہ۔ دوسرا حصہ۔",
      chunkCount: 1,
      chunkSpans: [{ start: 0, end: 30, text: "پہلا حصہ۔ دوسرا حصہ۔" }],
    });
    const { container } = renderPage();
    drop(new File(["a"], "bayan.m4a", { type: "audio/mp4" }));
    expect(await screen.findByRole("list", { name: "آڈیو کے ساتھ متن" })).toBeInTheDocument();
    expect(container.querySelector("audio")).toHaveAttribute("src", "blob:recording");
    // Cloud times are estimates, and subtitles are never made from them.
    expect(screen.getByText(/وقت اندازاً ہیں/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /SRT/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "ترمیم" }));
    expect(screen.getByDisplayValue("پہلا حصہ۔ دوسرا حصہ۔")).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("tab", { name: "ترمیم" }));
    const box = (await screen.findByDisplayValue(/دوسرا/)) as HTMLTextAreaElement;
    expect(box.value).toBe("--- صفحہ 1 ---\nپہلا\n\n--- صفحہ 2 ---\nدوسرا");
    await waitFor(() =>
      expect(upsertUserSession).toHaveBeenCalledWith(expect.objectContaining({ section: "ocr", metadata: { extractedText: box.value } })),
    );
  });

  it("shows a scan beside its text, uncertain words in yellow, page by page", async () => {
    getPdfPageCount.mockResolvedValue(2);
    renderPdfPages.mockImplementation(async function* () {
      yield { pageNum: 1, totalPages: 2, imageBase64: "a", mimeType: "image/jpeg" };
      yield { pageNum: 2, totalPages: 2, imageBase64: "b", mimeType: "image/jpeg" };
    });
    ocrPageImage.mockResolvedValueOnce("قال الشيخ[?] رحمه الله").mockResolvedValueOnce("دوسرا صفحہ");
    renderPage();
    drop(new File(["%PDF"], "fatawa.pdf", { type: "application/pdf" }));

    const word = await screen.findByText("الشيخ");
    expect(word.tagName).toBe("MARK");
    expect(screen.getByRole("img", { name: "صفحہ 1 کی تصویر" })).toHaveAttribute("src", "data:image/jpeg;base64,a");
    expect(screen.getByText(/1 غیر یقینی الفاظ/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "اگلا صفحہ" }));
    expect(screen.getByText("دوسرا صفحہ")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "صفحہ 2 کی تصویر" })).toHaveAttribute("src", "data:image/jpeg;base64,b");

    // Edit shows the whole text, with a note pointing back to the image.
    fireEvent.click(screen.getByRole("tab", { name: "ترمیم" }));
    expect(screen.getByDisplayValue(/قال الشيخ\[\?\]/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "تصویر سے ملائیں" }));
    expect(screen.getByRole("tab", { name: "تصویر کے ساتھ" })).toHaveAttribute("aria-selected", "true");
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
    await screen.findByText("متن");
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("متن"));
  });

  it("makes a document from the result", async () => {
    ocrPageImage.mockResolvedValue("فتویٰ کا متن");
    renderPage();
    drop(new File(["x"], "page.png", { type: "image/png" }));
    await screen.findByText("فتویٰ کا متن");
    fireEvent.click(screen.getByRole("button", { name: /دستاویز بنائیں/ }));
    expect(landed).toEqual({ pathname: "/workspace", state: { content: "فتویٰ کا متن", source: "ocr", projectId: undefined } });
  });

  it("starts at once on a file shared into the app", async () => {
    takeSharedFile.mockResolvedValueOnce(new File(["a"], "PTT-20261021.opus", { type: "audio/ogg" }));
    transcribeLongForm.mockResolvedValue({ text: "وائس نوٹ کا متن", chunkCount: 1 });
    renderPage("/extract?shared=1");
    expect(await screen.findByDisplayValue("وائس نوٹ کا متن")).toBeInTheDocument();
  });

  it("asks a signed-out user to sign in before reading pages", () => {
    currentUser = null;
    renderPage();
    drop(new File(["x"], "page.png", { type: "image/png" }));
    expect(toast.error).toHaveBeenCalledWith("extract.sign_in_for_pages");
    expect(ocrPageImage).not.toHaveBeenCalled();
  });
});
