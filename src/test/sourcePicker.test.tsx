import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SourcePicker from "@/components/research/SourcePicker";
import { ALL_SOURCE_IDS, RESEARCH_SOURCES } from "@/lib/research/sources";
import en from "@/locales/en.json";

/**
 * Corpus Atlas finding #1: the backend has honoured `selectedDomains` end to
 * end for months, but nothing in the UI could set it. This pins the control's
 * two load-bearing behaviours:
 *
 *   - "no selection" means EVERY source (ADR-0002's default survives), and
 *   - unchecking one source must not collapse the other seventeen, which is
 *     what a naive `selected.filter()` on an empty array would do.
 */

const t = ((key: string, fallback?: string) =>
  (en as Record<string, string>)[key] ?? fallback ?? key) as unknown as
  import("@/lib/i18n").Translator;

function setup(selected: string[] = []) {
  const onSelectedChange = vi.fn();
  render(<SourcePicker selected={selected} onSelectedChange={onSelectedChange} t={t} />);
  return { onSelectedChange };
}

const openPopover = () => fireEvent.click(screen.getByRole("button", { name: en["research.sources_label"] }));

describe("SourcePicker", () => {
  it("reads as 'All sources' and shows everything checked by default", () => {
    setup([]);
    expect(screen.getByText(en["research.sources_all"])).toBeInTheDocument();

    openPopover();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(RESEARCH_SOURCES.length);
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it("keeps the other sources when the first one is unchecked", () => {
    const { onSelectedChange } = setup([]);
    openPopover();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    const next = onSelectedChange.mock.calls[0][0] as string[];
    expect(next).toHaveLength(ALL_SOURCE_IDS.length - 1);
    expect(next).not.toContain(RESEARCH_SOURCES[0].id);
    // ...and it is emphatically NOT the empty array, which the backend reads
    // as "search everything" — the opposite of what the user just asked for.
    expect(next.length).toBeGreaterThan(0);
  });

  it("collapses back to 'everything' once every source is re-checked", () => {
    const oneMissing = ALL_SOURCE_IDS.filter((id) => id !== RESEARCH_SOURCES[0].id);
    const { onSelectedChange } = setup(oneMissing);
    openPopover();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onSelectedChange).toHaveBeenCalledWith([]);
  });

  it("clears a whole group at once, keeping the rest", () => {
    const { onSelectedChange } = setup([]);
    openPopover();

    // Every group starts fully checked, so each group button offers "Clear".
    fireEvent.click(screen.getAllByRole("button", { name: en["research.sources_group_none"] })[0]);

    const next = onSelectedChange.mock.calls[0][0] as string[];
    const corpusIds = RESEARCH_SOURCES.filter((s) => s.group === "corpus").map((s) => s.id);
    for (const id of corpusIds) expect(next).not.toContain(id);
    expect(next).toHaveLength(ALL_SOURCE_IDS.length - corpusIds.length);
  });

  it("offers a reset only when narrowed, and resets to everything", () => {
    const { onSelectedChange } = setup(["tanzil"]);
    expect(screen.getByText(`1 ${en["research.sources_unit"]}`)).toBeInTheDocument();

    openPopover();
    fireEvent.click(screen.getByRole("button", { name: en["research.sources_reset"] }));
    expect(onSelectedChange).toHaveBeenCalledWith([]);
  });

  it("hides the reset control when nothing is narrowed", () => {
    setup([]);
    openPopover();
    expect(screen.queryByRole("button", { name: en["research.sources_reset"] })).not.toBeInTheDocument();
  });
});
