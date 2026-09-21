import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The library upload dialog's token gate.
 *
 * On desktop the dialog was permanently disabled: it demanded a token balance
 * ("Insufficient tokens! Balance: 0") that a runtime with no token wallet can
 * never have, so a local user could not upload a book at all. The capability
 * registry already says why: `tokens.meter` is desktop:never — "Desktop runs on
 * the user's own BYOK key, so there is no token balance."
 */

const balance = vi.hoisted(() => ({ total: 0 as number | undefined }));
vi.mock("@/hooks/useTokenBalance", () => ({
  useTokenBalance: () => ({ total: balance.total }),
}));
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (_k: string, f: string) => f,
    direction: "ltr",
  }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// translateStored* resolve locale keys; echo the key + params so assertions can see what was raised.
vi.mock("@/lib/i18n", () => ({
  translateStored: (key: string) => key,
  translateStoredFormat: (key: string, vars: Record<string, unknown>) => `${key} ${JSON.stringify(vars)}`,
}));

const upload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/corpus/libraryChunkService", () => ({
  libraryChunkService: { uploadLibraryFile: upload },
}));

const ingest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/corpus/ingestOrchestrator", () => ({ runLibraryIngest: ingest }));

import { SourceUploadDialog } from "@/components/workspace/SourceUploadDialog";

function asDesktop() {
  (globalThis as { window?: unknown }).window = globalThis.window ?? {};
  (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true };
}

const chooseFile = (size = 5000) => {
  const file = new File(["x".repeat(size)], "book.txt", { type: "text/plain" });
  fireEvent.change(document.getElementById("file-upload") as HTMLInputElement, { target: { files: [file] } });
};

const submit = () => screen.getByRole("button", { name: /Upload and process/ });

const renderDialog = () => render(<SourceUploadDialog open={true} onOpenChange={vi.fn()} />);

beforeEach(() => {
  vi.clearAllMocks();
  balance.total = 0;
  upload.mockResolvedValue({ id: "item-1" });
  ingest.mockResolvedValue({ done: true, inserted: 3 });
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("SourceUploadDialog — desktop (no token wallet)", () => {
  beforeEach(asDesktop);

  it("REGRESSION: submit is enabled with a zero balance", () => {
    balance.total = 0;
    renderDialog();
    chooseFile();
    expect(submit()).toBeEnabled();
  });

  it("shows neither the token cost nor the 'insufficient tokens' warning", () => {
    balance.total = 0;
    renderDialog();
    chooseFile();
    expect(screen.queryByText(/Estimated cost/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Insufficient tokens/)).not.toBeInTheDocument();
    // the chunk estimate is still useful and stays
    expect(screen.getByText(/Estimated chunks/)).toBeInTheDocument();
  });

  it("uploads and starts ingest instead of raising the token error", async () => {
    balance.total = 0;
    renderDialog();
    chooseFile();
    fireEvent.click(submit());

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ingest).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("still needs a file before it can submit", () => {
    renderDialog();
    expect(submit()).toBeDisabled();
  });

  it("shows a clear error — not a silent failure — when ingest fails for want of a Gemini key", async () => {
    // electron/ai/geminiClient.ts throws this when no BYOK key is stored.
    ingest.mockRejectedValue(new Error("کوئی Gemini key پاس نہیں کی گئی — Settings میں اپنی کلید درج کریں"));
    renderDialog();
    chooseFile();
    fireEvent.click(submit());

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const message = String(toast.error.mock.calls[0][0]);
    expect(message).toContain("toast.library.processing_failed");
    expect(message).toContain("Gemini key");
    expect(message).toContain("Settings");
  });
});

describe("SourceUploadDialog — web (token wallet)", () => {
  it("submit is still disabled when the balance cannot cover the estimate", () => {
    balance.total = 3; // 5000 bytes ≈ 5 chunks ≈ 25 tokens
    renderDialog();
    chooseFile(5000);
    expect(submit()).toBeDisabled();
    expect(screen.getByText(/Insufficient tokens/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated cost/)).toBeInTheDocument();
  });

  it("does not upload when the (disabled) submit is somehow triggered with an insufficient balance", () => {
    balance.total = 3;
    renderDialog();
    chooseFile(5000);
    fireEvent.click(submit());
    expect(upload).not.toHaveBeenCalled();
  });

  it("enables submit once the balance covers the estimate", () => {
    balance.total = 1000;
    renderDialog();
    chooseFile(5000);
    expect(submit()).toBeEnabled();
    expect(screen.queryByText(/Insufficient tokens/)).not.toBeInTheDocument();
  });

  it("a zero balance blocks the upload on web (the wallet is real there)", () => {
    balance.total = 0;
    renderDialog();
    chooseFile();
    expect(submit()).toBeDisabled();
  });
});

describe("SourceUploadDialog — ingest failure feedback", () => {
  beforeEach(asDesktop);

  it("REGRESSION: Electron's IPC wrapper is stripped from the message the user sees", async () => {
    ingest.mockRejectedValue(new Error("Error invoking remote method 'ai:invoke': ByokApiError: کوئی Gemini key پاس نہیں کی گئی — Settings میں اپنی کلید درج کریں"));
    renderDialog();
    chooseFile();
    fireEvent.click(submit());

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const message = String(toast.error.mock.calls[0][0]);
    expect(message).not.toContain("Error invoking remote method");
    expect(message).not.toContain("ByokApiError");
    expect(message).toContain("Gemini key");
  });

  it("REGRESSION: the progress card shows the failure instead of sitting at 'Extracting… 0%' forever", async () => {
    ingest.mockImplementation(async ({ onProgress }: { onProgress?: (p: unknown) => void }) => {
      onProgress?.({ itemId: "item-1", inserted: 0, totalChunks: 0, progressPercent: 0, done: false, status: "extracting" });
      throw new Error("Error invoking remote method 'ai:invoke': Error: [Could not read file]");
    });
    renderDialog();
    chooseFile();
    fireEvent.click(submit());

    expect(await screen.findByText("Processing incomplete")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("[Could not read file]");
    expect(screen.queryByText("Extracting text…")).not.toBeInTheDocument();
  });

  it("shows the failure even if the ingest failed before reporting any progress", async () => {
    ingest.mockRejectedValue(new Error("boom"));
    renderDialog();
    chooseFile();
    fireEvent.click(submit());
    expect(await screen.findByText("Processing incomplete")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
