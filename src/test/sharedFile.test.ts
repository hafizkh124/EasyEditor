import { describe, it, expect, afterEach } from "vitest";
import { takeSharedFile } from "@/lib/extract/sharedFile";

/** The shared file is handed over once, with its name and type. */
describe("takeSharedFile", () => {
  afterEach(() => {
    delete (globalThis as { caches?: unknown }).caches;
  });

  it("returns the parked file once, then nothing", async () => {
    const store = new Map<string, Response>([
      ["/shared-file", new Response(new Blob(["x"]), { headers: { "Content-Type": "audio/ogg", "X-File-Name": encodeURIComponent("وائس نوٹ.opus") } })],
    ]);
    (globalThis as { caches?: unknown }).caches = {
      open: async () => ({
        match: async (k: string) => store.get(k),
        delete: async (k: string) => store.delete(k),
      }),
    };
    const file = await takeSharedFile();
    expect(file?.name).toBe("وائس نوٹ.opus");
    expect(file?.type).toBe("audio/ogg");
    expect(await takeSharedFile()).toBeNull();
  });

  it("is null where there is no Cache API", async () => {
    expect(await takeSharedFile()).toBeNull();
  });
});
