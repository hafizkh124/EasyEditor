import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * SYSTEM-2026 §10 — with the user's own Gemini key the desktop reads and
 * translates pages in its main process: no account, no tokens, no network
 * call to our functions.
 */

import { ocrPageImage } from "@/lib/ocr/ocrClient";
import { translateOnePage } from "@/lib/translate/translatePageApi";

type Listener = (data: { chunk?: string; done?: boolean; error?: string }) => void;

function desktopWithKey(hasKey: boolean) {
  const listeners = new Map<string, Listener>();
  const invoke = vi.fn(async (_channel: string, req: { functionName: string; streamChannelId?: string }) => {
    if (req.functionName === "translate-page") {
      listeners.get(req.streamChannelId!)?.({ chunk: "ترجمہ " });
      listeners.get(req.streamChannelId!)?.({ chunk: "ہو گیا" });
      return { data: { text: "ترجمہ ہو گیا" } };
    }
    return { data: { text: "پڑھا گیا متن" } };
  });
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    isDesktop: true,
    invoke,
    byok: {
      getKeyStatus: vi.fn(async () => ({ hasKey, lastFour: hasKey ? "abcd" : null })),
      onStreamChunk: (id: string, cb: Listener) => {
        listeners.set(id, cb);
        return () => listeners.delete(id);
      },
    },
  };
  return invoke;
}

describe("desktop own-key pages", () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.unstubAllGlobals();
  });

  it("reads a page in the main process", async () => {
    const invoke = desktopWithKey(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await ocrPageImage("BASE64", "image/png")).toBe("پڑھا گیا متن");
    expect(invoke).toHaveBeenCalledWith("ai:invoke", {
      mode: "edge-function", functionName: "process-ocr", body: { imageBase64: "BASE64", mimeType: "image/png" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("translates a page in the main process, streaming as it goes, with no session", async () => {
    const invoke = desktopWithKey(true);
    vi.stubGlobal("fetch", vi.fn());
    const chunks: string[] = [];
    const text = await translateOnePage({ text: "الحمد لله", targetLanguage: "ur", genreInstruction: "literal", onChunk: (c) => chunks.push(c) });
    expect(text).toBe("ترجمہ ہو گیا");
    expect(chunks).toEqual(["ترجمہ ", "ترجمہ ہو گیا"]);
    expect(invoke.mock.calls[0][1]).toMatchObject({
      functionName: "translate-page", body: { text: "الحمد لله", targetLanguage: "ur", genreInstruction: "literal" },
    });
  });

  it("uses the account when the desktop has no key", async () => {
    const invoke = desktopWithKey(false);
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ text: "cloud" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await translateOnePage({ text: "x", targetLanguage: "ur", accessToken: "tok" })).toBe("cloud");
    expect(invoke).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
  });
});
