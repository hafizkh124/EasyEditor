import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MobileTaskSheet } from "@/components/editor/MobileTaskSheet";
import { getTasksForSurface } from "@/lib/tasks/registry";

/**
 * SPEC-M3 FR-3.4 / NFR-3 / NFR-4 — the touch layout.
 *
 * On iOS the system draws its own selection callout over any floating element,
 * and the on-screen keyboard covers where a popup would sit, so below 768px the
 * tasks must live in a bottom sheet instead of a floating bar.
 */

const noopActions = {
  onAddHarakat: vi.fn(),
  onRemoveHarakat: vi.fn(),
  onSpellCheck: vi.fn(),
  onParaphrase: vi.fn(),
  onSummarize: vi.fn(),
  onCitations: vi.fn(),
};

function renderSheet(selectedText = "منتخب متن") {
  return render(
    <MobileTaskSheet
      open
      onOpenChange={() => {}}
      selectedText={selectedText}
      aiBusy={null}
      getHandler={(slug) =>
        ({
          add_harakat: noopActions.onAddHarakat,
          spelling_check: noopActions.onSpellCheck,
          citations: noopActions.onCitations,
        })[slug]
      }
    />,
  );
}

describe("MobileTaskSheet (FR-3.4)", () => {
  it("renders in RTL so Urdu labels read correctly", () => {
    const { baseElement } = renderSheet();
    expect(baseElement.querySelector("[dir='rtl']")).not.toBeNull();
  });

  it("gives every task an accessible name that includes its token cost", () => {
    renderSheet();
    // NFR-4: an icon or truncated label is not an accessible name, and the cost
    // must be discoverable without running the action (FR-2.6 in spirit).
    const button = screen.getByRole("button", { name: /حرکات لگائیں.*ٹوکن/ });
    expect(button).toBeInTheDocument();
  });

  it("runs the handler the caller supplied for that slug", () => {
    renderSheet();
    screen.getByRole("button", { name: /حرکات لگائیں.*ٹوکن/ }).click();
    expect(noopActions.onAddHarakat).toHaveBeenCalled();
  });

  it("shows only bubble-surface tasks, so auto_format stays out", () => {
    // The mobile sheet is the touch equivalent of the bubble bar, so FR-2.3
    // applies to it identically.
    const slugs = getTasksForSurface("bubble").map((t) => t.slug);
    expect(slugs).not.toContain("auto_format");
  });
});
