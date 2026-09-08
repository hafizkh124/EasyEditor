import { describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "@/core/workspace/WorkspaceContext";
import { WorkbenchPanel } from "@/components/workspace/WorkbenchPanel";

// Radix's TabsTrigger selects on `mousedown`, not `click` (its own source:
// @radix-ui/react-tabs/dist/index.mjs composes onValueChange into
// onMouseDown) — jsdom's `.click()` never synthesizes that, unlike a real
// browser's click sequence. Found while writing workbenchTabConsolidation.test.tsx:
// this file's own `.click()` below had silently never been exercising a real
// tab switch — only the mount-count/no-unmount assertions, which don't
// depend on the switch actually landing, ever passed either way.
function selectTab(el: HTMLElement) {
  act(() => { fireEvent.mouseDown(el); });
}

/**
 * FR-1.5 / FR-4.3 — the Workbench must never unmount.
 *
 * This is the regression net for SPEC-M2's highest-severity risk: a closed or
 * background tab that unmounts kills the in-flight SSE research answer. The test
 * therefore renders the REAL `WorkbenchPanel` and counts how many times each
 * child panel mounts. Asserting against a locally-built stub would pass even if
 * `WorkbenchPanel` were rewritten to unmount its children.
 */

const mountCounts = { research: 0, translate: 0 };

/**
 * Counts MOUNTS, not renders. Incrementing in the function body would climb on
 * every re-render and the assertion would fail for the wrong reason — which
 * would say nothing about whether the panel survived.
 */
function makeStub(key: keyof typeof mountCounts) {
  return function Stub() {
    useEffect(() => {
      mountCounts[key]++;
    }, []);
    return <div data-testid={`${key}-panel`} />;
  };
}

vi.mock("@/components/research/ResearchPanel", () => ({ ResearchPanel: makeStub("research") }));
vi.mock("@/components/translate/TranslatePanel", () => ({ TranslatePanel: makeStub("translate") }));

function renderWorkbench() {
  return render(
    <MemoryRouter>
      <WorkspaceProvider>
        <WorkbenchPanel alwaysVisible />
      </WorkspaceProvider>
    </MemoryRouter>,
  );
}

describe("Workbench keep-mounted (FR-4.3 / FR-1.5)", () => {
  it("mounts every tab's panel at once, not just the active one", () => {
    mountCounts.research = 0;
    mountCounts.translate = 0;

    renderWorkbench();

    // Both exist in the DOM even though only one tab is selected.
    expect(screen.getByTestId("research-panel")).toBeInTheDocument();
    expect(screen.getByTestId("translate-panel")).toBeInTheDocument();
  });

  it("hides inactive tabs with CSS instead of unmounting them", () => {
    renderWorkbench();

    // The inactive panels' wrappers carry `hidden` — proof the mechanism is a
    // class swap, which is what keeps an SSE stream alive across a tab switch.
    const translateWrapper = screen.getByTestId("translate-panel").parentElement;
    expect(translateWrapper).toHaveClass("hidden");

    const researchWrapper = screen.getByTestId("research-panel").parentElement;
    expect(researchWrapper).not.toHaveClass("hidden");
  });

  it("does not remount any panel when the Workbench is switched or closed", () => {
    mountCounts.research = 0;
    mountCounts.translate = 0;

    renderWorkbench();
    const afterFirstRender = { ...mountCounts };

    // Switch tabs — and actually confirm the switch landed, not just that
    // nothing crashed — then close the panel entirely.
    selectTab(screen.getByTitle("Translate"));
    expect(screen.getByTestId("translate-panel").parentElement).not.toHaveClass("hidden");
    expect(screen.getByTestId("research-panel").parentElement).toHaveClass("hidden");

    act(() => {
      const closeBtn = document.querySelector<HTMLButtonElement>("[aria-label='Close Workbench']");
      closeBtn?.click();
    });

    expect(screen.getByTestId("research-panel")).toBeInTheDocument();
    expect(mountCounts.research).toBe(afterFirstRender.research);
    expect(mountCounts.translate).toBe(afterFirstRender.translate);
  });
});
