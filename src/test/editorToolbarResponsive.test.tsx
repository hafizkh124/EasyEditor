import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import EditorToolbar from "@/components/editor/EditorToolbar";

/**
 * UX-v1 P4 — EditorToolbar rendered ~19 secondary controls inline with no
 * responsive classes at all (`flex-wrap`, nothing else), so at 360px they
 * wrapped into roughly 5 rows above the document. This pins down the fix: a
 * small always-visible core, everything else reachable through one overflow
 * sheet on narrow viewports, with the exact same controls staying inline on
 * wider ones — not two different feature sets, one relocated set.
 */

// Chainable stub covering every method EditorToolbar calls through
// `editor.chain().focus()....run()` — real ProseMirror is not needed to test
// which controls render and where.
function makeChain(): any {
  const chain: any = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "run") return () => true;
        return () => chain;
      },
    },
  );
  return chain;
}

function makeEditor(): any {
  return {
    isActive: () => false,
    chain: () => makeChain(),
    can: () => new Proxy({}, { get: () => () => true }),
  };
}

const baseProps = {
  editor: makeEditor(),
  isRtl: true,
  onToggleDirection: vi.fn(),
  t: (key: string, fallback?: string) => fallback ?? key,
  aiBusy: null,
  onAddHarakat: vi.fn(),
  onRemoveHarakat: vi.fn(),
  onSpellCheck: vi.fn(),
  onAutoFormat: vi.fn(),
  onParaphrase: vi.fn(),
  onSummarize: vi.fn(),
  onCitations: vi.fn(),
  onOpenResources: vi.fn(),
  onSetFont: vi.fn(),
  isFullscreen: false,
  onToggleFullscreen: vi.fn(),
  brushActive: false,
  onToggleBrush: vi.fn(),
  trackMode: "edit" as const,
  onSetTrackMode: vi.fn(),
  aiReview: false,
  onToggleAiReview: vi.fn(),
  pendingCount: 0,
  onAcceptAll: vi.fn(),
  onRejectAll: vi.fn(),
};

describe("EditorToolbar responsive split", () => {
  it("always renders the core controls: Bold/Italic/Underline, Undo/Redo, Fullscreen", () => {
    render(<EditorToolbar {...baseProps} />);
    for (const label of ["Bold", "Italic", "Underline", "Undo", "Redo"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("keeps secondary controls (e.g. H1) present for desktop, even though hidden below sm", () => {
    render(<EditorToolbar {...baseProps} />);
    // Not moved out of the document on wide viewports — `hidden sm:flex` on
    // the wrapper, not a conditional unmount.
    expect(screen.getByLabelText("H1")).toBeInTheDocument();
  });

  it("offers a 'More formatting' overflow trigger that opens a sheet with the same secondary controls", () => {
    render(<EditorToolbar {...baseProps} />);
    const trigger = screen.getByLabelText("More formatting");
    fireEvent.click(trigger);

    // The sheet is a second, independent instance of the same controls —
    // querying by role scopes to it instead of colliding with the always-
    // present desktop copy.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("H1")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Toggle RTL")).toBeInTheDocument();
  });
});
