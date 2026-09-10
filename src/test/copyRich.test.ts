// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyRich } from "@/lib/export/copyRich";

describe("copyRich", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes text/html + text/plain when ClipboardItem is available", async () => {
    const write = vi.fn(async () => undefined);
    vi.stubGlobal("ClipboardItem", class {
      constructor(public items: Record<string, Blob>) {}
    });
    vi.stubGlobal("navigator", { clipboard: { write, writeText: vi.fn() } });
    const ok = await copyRich("<b>x</b>", "x");
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledOnce();
  });

  it("falls back to writeText when rich copy throws", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("ClipboardItem", class {
      constructor() { throw new Error("no rich clipboard"); }
    });
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn(), writeText } });
    const ok = await copyRich("<b>x</b>", "plain");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("plain");
  });
});
