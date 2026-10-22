import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * M11 Phase 3 / M12 Phase H — ComposerHub, the shared `+` hub embedded by
 * both AgentComposer.tsx and (conceptually) the research composer. ADR-0047
 * promised a `composerHub.test.tsx` covering the hub rows; it never existed
 * until now. Covers the rows that gate on a handler prop, plus the one bug
 * fixed alongside the Prompts wiring: "Custom prompts"/"Assist modes" were
 * hardcoded English literals, not translated like every sibling row.
 */
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

import { ComposerHub } from "@/components/composer/ComposerHub";

describe("ComposerHub", () => {
  it("hides a row when its handler prop is absent, even if its show* flag is on", () => {
    render(<ComposerHub showPrompts showScholarlyPrompts showAssistModes />);
    expect(screen.queryByText("Custom prompts")).not.toBeInTheDocument();
    expect(screen.queryByText(/14/)).not.toBeInTheDocument();
    expect(screen.queryByText("Assist modes")).not.toBeInTheDocument();
  });

  it("shows the Scholarly prompts row (the 14-template library) and wires it, closing the hub", () => {
    const onOpenScholarlyPrompts = vi.fn();
    const onClose = vi.fn();
    render(<ComposerHub showScholarlyPrompts onOpenScholarlyPrompts={onOpenScholarlyPrompts} onClose={onClose} />);
    fireEvent.click(screen.getByText(/14/));
    expect(onOpenScholarlyPrompts).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the Prompts row through t() and wires it to onOpenPrompts, closing the hub", () => {
    const onOpenPrompts = vi.fn();
    const onClose = vi.fn();
    render(<ComposerHub showPrompts onOpenPrompts={onOpenPrompts} onClose={onClose} />);
    fireEvent.click(screen.getByText("Custom prompts"));
    expect(onOpenPrompts).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the Assist modes row through t() and wires it to onOpenAssistModes", () => {
    const onOpenAssistModes = vi.fn();
    render(<ComposerHub showAssistModes onOpenAssistModes={onOpenAssistModes} />);
    fireEvent.click(screen.getByText("Assist modes"));
    expect(onOpenAssistModes).toHaveBeenCalledTimes(1);
  });

  it("wires the Skills (/) and Books & sources rows", () => {
    const onOpenPlaybooks = vi.fn();
    const onOpenScope = vi.fn();
    render(<ComposerHub onOpenPlaybooks={onOpenPlaybooks} onOpenScope={onOpenScope} />);
    fireEvent.click(screen.getByText(/^مہارتیں/));
    fireEvent.click(screen.getByText(/^Books & sources/));
    expect(onOpenPlaybooks).toHaveBeenCalledTimes(1);
    expect(onOpenScope).toHaveBeenCalledTimes(1);
  });

  it("wires the Add files and Change folder rows", () => {
    const onAddFiles = vi.fn();
    const onChangeFolder = vi.fn();
    render(<ComposerHub onAddFiles={onAddFiles} onChangeFolder={onChangeFolder} />);
    fireEvent.click(screen.getByText("Add recordings, scans, fonts…"));
    fireEvent.click(screen.getByText("Change project folder"));
    expect(onAddFiles).toHaveBeenCalledTimes(1);
    expect(onChangeFolder).toHaveBeenCalledTimes(1);
  });
});
