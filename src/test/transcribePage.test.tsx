import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The Transcribe page's state machine, pinned before it is refactored.
 *
 * 16 `useState`s and 14 effects drive one flow: resolve the STT route (local
 * Whisper vs cloud) → validate the upload → run the chunked orchestrator →
 * publish transcript and segments → refine or export. These tests assert those
 * decisions and the arguments handed to the orchestrator, not the markup.
 */

// `vi.mock` factories are hoisted above the module body, and this factory
// dereferences the error class while it runs — not lazily like the spies below.
// `vi.hoisted` is what makes it exist by then.
const { transcribeLongForm, resolveSttRoute, TranscribeCancelledError } = vi.hoisted(() => {
  class TranscribeCancelledError extends Error {}
  return {
    transcribeLongForm: vi.fn(),
    resolveSttRoute: vi.fn(),
    TranscribeCancelledError,
  };
});

vi.mock("@/lib/audio/transcribeLongForm", () => ({
  transcribeLongForm: (...a: unknown[]) => transcribeLongForm(...a),
  resolveSttRoute: () => resolveSttRoute(),
  TranscribeCancelledError,
  MAX_DURATION_SECONDS: 3600,
}));

let canAfford = true;
let currentUser: { id: string } | null = { id: "u1" };
vi.mock("@/hooks/useTokenBalance", () => ({
  useCanAfford: () => ({ canAfford }),
  useTokenBalance: () => ({ balance: 1000, refetch: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: currentUser, session: { access_token: "tok" } }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

const TEMPLATES: Record<string, string> = {
  "stt.upload_success_chunked": "Done in {n} chunks",
};
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (k: string, fb?: string) => TEMPLATES[k] ?? fb ?? k, direction: "rtl", language: "ur" }),
}));
vi.mock("@/hooks/useSeo", () => ({ useSeo: () => {} }));
// The real hook returns { save, reset, currentId }; the page destructures
// `save` as `saveSession`. Getting this shape wrong throws inside the success
// path, which is caught and reported as a generic failure.
vi.mock("@/hooks/usePageSession", () => ({
  usePageSession: () => ({ save: vi.fn(), reset: vi.fn(), currentId: null }),
}));
vi.mock("@/lib/activityLog", () => ({ logActivity: vi.fn() }));
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

import Transcribe from "@/pages/Transcribe";
import { MAX_FILE_SIZE_BYTES } from "@/lib/audio/formatSupport";

function renderPage() {
  return render(<MemoryRouter><Transcribe /></MemoryRouter>);
}

function mediaInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  if (!input) throw new Error("Transcribe rendered without a file input");
  return input;
}

function upload(file: File) {
  fireEvent.change(mediaInput(), { target: { files: [file] } });
}

function makeFile(name: string, type: string, size = 1024): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

beforeEach(() => {
  canAfford = true;
  currentUser = { id: "u1" };
  vi.clearAllMocks();
  resolveSttRoute.mockResolvedValue("cloud");
  transcribeLongForm.mockResolvedValue({ text: "متن", chunkCount: 1, segments: null });
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("Transcribe — upload validation", () => {
  it("refuses a file over the size cap before decoding it", async () => {
    renderPage();
    upload(makeFile("huge.wav", "audio/wav", MAX_FILE_SIZE_BYTES + 1));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("stt.file_too_large"));
    expect(transcribeLongForm).not.toHaveBeenCalled();
  });

  it("warns that a video will have its audio extracted, then proceeds", async () => {
    renderPage();
    upload(makeFile("lecture.mp4", "video/mp4"));
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith("stt.video_info"));
    expect(transcribeLongForm).toHaveBeenCalled();
  });

  it("does not start a run the balance cannot cover", async () => {
    canAfford = false;
    renderPage();
    upload(makeFile("talk.wav", "audio/wav"));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("stt.limit_reached"));
    expect(transcribeLongForm).not.toHaveBeenCalled();
  });
});

describe("Transcribe — route resolution", () => {
  it("runs on the cloud route by default", async () => {
    renderPage();
    upload(makeFile("talk.wav", "audio/wav"));
    await waitFor(() => expect(transcribeLongForm).toHaveBeenCalled());
    expect(transcribeLongForm.mock.calls[0][0]).toMatchObject({ route: "cloud" });
  });

  it("runs locally when a Whisper model is available", async () => {
    resolveSttRoute.mockResolvedValue("local");
    renderPage();
    // The route is resolved in an effect; wait for it before uploading.
    await waitFor(() => expect(resolveSttRoute).toHaveBeenCalled());
    upload(makeFile("talk.wav", "audio/wav"));
    await waitFor(() => expect(transcribeLongForm).toHaveBeenCalled());
    expect(transcribeLongForm.mock.calls[0][0]).toMatchObject({ route: "local" });
  });

  it("is not gated on the token balance when running locally", async () => {
    canAfford = false;
    resolveSttRoute.mockResolvedValue("local");
    renderPage();
    await waitFor(() => expect(resolveSttRoute).toHaveBeenCalled());
    upload(makeFile("talk.wav", "audio/wav"));
    // Local transcription costs nothing, so an empty wallet must not block it.
    await waitFor(() => expect(transcribeLongForm).toHaveBeenCalled());
  });

  it("tells a signed-out desktop user to download a model, not to buy tokens", async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true };
    currentUser = null;
    canAfford = false;
    resolveSttRoute.mockResolvedValue("cloud");
    renderPage();
    await waitFor(() => expect(resolveSttRoute).toHaveBeenCalled());
    expect(await screen.findByText("stt.needs_local_model")).toBeInTheDocument();
    expect(screen.queryByText("stt.limit_reached")).not.toBeInTheDocument();
  });
});

describe("Transcribe — results", () => {
  it("publishes the transcript and reports a single-shot run", async () => {
    renderPage();
    upload(makeFile("talk.wav", "audio/wav"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("stt.upload_success"));
    // The transcript is a read-only <div>, not a form control.
    expect(await screen.findByText("متن")).toBeInTheDocument();
  });

  it("names the chunk count when the run was split", async () => {
    transcribeLongForm.mockResolvedValue({ text: "متن", chunkCount: 4, segments: null });
    renderPage();
    upload(makeFile("long.wav", "audio/wav"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("4")));
  });

  it("reports a cancelled run as cancelled rather than as an error", async () => {
    transcribeLongForm.mockRejectedValue(new TranscribeCancelledError("cancelled"));
    renderPage();
    upload(makeFile("talk.wav", "audio/wav"));
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith("stt.cancelled"));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("surfaces a failure instead of leaving the page mid-progress", async () => {
    transcribeLongForm.mockRejectedValue(new Error("engine died"));
    renderPage();
    upload(makeFile("talk.wav", "audio/wav"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it("appends to an existing transcript rather than replacing it", async () => {
    renderPage();
    upload(makeFile("one.wav", "audio/wav"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    transcribeLongForm.mockResolvedValue({ text: "دوسرا", chunkCount: 1, segments: null });
    upload(makeFile("two.wav", "audio/wav"));

    // Both runs must be present in one block: the second appends rather than
    // overwrites. getByText normalises the joining newline to a space.
    expect(await screen.findByText("متن دوسرا")).toBeInTheDocument();
  });
});

describe("Transcribe — subtitle export", () => {
  it("stays disabled until a run returns timestamps", async () => {
    renderPage();
    upload(makeFile("talk.wav", "audio/wav"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    const srt = screen.queryAllByRole("button", { name: /srt/i });
    srt.forEach((b) => expect(b).toBeDisabled());
  });

  it("becomes available once segments arrive", async () => {
    transcribeLongForm.mockResolvedValue({
      text: "متن",
      chunkCount: 1,
      segments: [{ start: 0, end: 1, text: "متن" }],
    });
    renderPage();
    upload(makeFile("talk.wav", "audio/wav"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    const srt = screen.queryAllByRole("button", { name: /srt/i });
    expect(srt.some((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });
});
