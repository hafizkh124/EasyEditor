// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The desktop renderer's half of "upload a book": it used to send only the file NAME to the
// main process, so no bytes ever reached disk (see localLibraryUpload.test.ts).

const invoke = vi.fn();
beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ id: "lib-1" });
  (globalThis as { window?: unknown }).window = { electronAPI: { invoke, isDesktop: true } };
});
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

const { localBackend } = await import("@/core/backend/localBackend");

describe("localBackend.library.uploadLibraryFile", () => {
  it("REGRESSION: sends the file's bytes to the main process along with the item", async () => {
    const text = "حدثنا فلان قال";
    const file = new File([text], "hadith.txt", { type: "text/plain" });

    await localBackend.library.uploadLibraryFile(file, "book");

    expect(invoke).toHaveBeenCalledTimes(1);
    const [channel, payload] = invoke.mock.calls[0];
    expect(channel).toBe("workspace:invoke");
    expect(payload.method).toBe("createItem");
    const [item, bytes] = payload.args;
    expect(item).toMatchObject({ title: "hadith.txt", kind: "book", storage_path: "hadith.txt" });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes).toString("utf8")).toBe(text);
  });

  it("maps the 'custom' kind to a note, as before", async () => {
    await localBackend.library.uploadLibraryFile(new File(["x"], "n.txt"), "custom");
    expect(invoke.mock.calls[0][1].args[0].kind).toBe("note");
  });

  it("carries binary files (PDF) byte for byte", async () => {
    const raw = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
    await localBackend.library.uploadLibraryFile(new File([raw], "b.pdf"), "book");
    const bytes = invoke.mock.calls[0][1].args[1] as Uint8Array;
    expect(Array.from(bytes)).toEqual(Array.from(raw));
  });
});
