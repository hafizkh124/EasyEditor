import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectionActionBar } from "@/components/workspace/SelectionActionBar";

/**
 * The selection bar shipped once with every handler wired to `() => {}` and a
 * selection string that was hard-coded empty, so it never rendered and nothing
 * it offered did anything. These tests pin both halves of that contract.
 */
function makeHandlers() {
  return {
    onAddHarakat: vi.fn(),
    onRemoveHarakat: vi.fn(),
    onSpellCheck: vi.fn(),
    onParaphrase: vi.fn(),
    onSummarize: vi.fn(),
    onCitations: vi.fn(),
  };
}

describe("SelectionActionBar", () => {
  it("renders nothing without a selection", () => {
    const { container } = render(<SelectionActionBar selectedText="   " {...makeHandlers()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers all six AI actions and calls the handler it was given", () => {
    const handlers = makeHandlers();
    render(<SelectionActionBar selectedText="قال مالك" {...handlers} />);

    const titles = [
      ["Add harakat", handlers.onAddHarakat],
      ["Remove harakat", handlers.onRemoveHarakat],
      ["Spell check", handlers.onSpellCheck],
      ["Paraphrase", handlers.onParaphrase],
      ["Summarize", handlers.onSummarize],
      ["Citations", handlers.onCitations],
    ] as const;

    for (const [title, handler] of titles) {
      fireEvent.click(screen.getByTitle(title));
      expect(handler, `${title} handler`).toHaveBeenCalledTimes(1);
    }
  });

  it("disables the actions while an AI call is in flight", () => {
    const handlers = makeHandlers();
    render(<SelectionActionBar selectedText="قال مالك" isBusy {...handlers} />);

    fireEvent.click(screen.getByTitle("Summarize"));
    expect(handlers.onSummarize).not.toHaveBeenCalled();
  });

  it("hides the Workbench button outside a workspace", () => {
    render(<SelectionActionBar selectedText="قال مالك" {...makeHandlers()} />);
    expect(screen.queryByText("Research in Workbench")).toBeNull();
  });
});
