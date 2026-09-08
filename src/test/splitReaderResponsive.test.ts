import { describe, it, expect } from "vitest";
import { readSource } from "./sourceScan";

/**
 * M10 Phase 3 §2 — SplitReader.tsx used to render its two reading columns
 * with a bare `flex` (no breakpoint), giving each pane ~187px at a 375px
 * viewport — unreadable for a full Arabic/Urdu page. Full mount is
 * disproportionate here (four hooks — useReaderState/useReaderProgress/
 * useReaderSettings/useOptionalWorkspace — would need mocking for what is a
 * pure layout-class change), so this follows pwaManifest.test.ts's pattern:
 * grep the committed source for the exact responsive classes, catching a
 * regression back to the old unconditional `flex` without needing a mount.
 */
const source = readSource(`${process.cwd()}/src/components/shamela/SplitReader.tsx`);

describe("SplitReader — responsive split (stacks below md)", () => {
  it("stacks the two panes in a column below md, side by side at md+", () => {
    expect(source).toContain('className="flex-1 min-h-0 flex flex-col md:flex-row"');
  });

  it("the divider between panes is horizontal below md, vertical at md+", () => {
    expect(source).toContain('className="h-px w-full md:h-full md:w-px bg-border shrink-0"');
  });

  it("each pane can actually shrink to its stacked half (min-h-0, not just min-w-0)", () => {
    expect(source).toContain('className="flex flex-col min-w-0 min-h-0 flex-1 bg-background"');
  });

  it("reads RTL from the reactive language context, not a one-time document.documentElement read", () => {
    expect(source).not.toMatch(/document\.documentElement\.dir/);
    expect(source).toContain("const { t, direction } = useLanguage();");
    expect(source).toContain('const rtl = direction === "rtl";');
  });

  it("pane and header icon buttons carry a touch target below md", () => {
    expect(source).toContain('className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0"');
    expect(source).toContain('className="h-8 w-8 min-h-touch min-w-touch md:min-h-0 md:min-w-0"');
  });
});
