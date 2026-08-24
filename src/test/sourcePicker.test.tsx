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

function setup(selected: string[] = [], requireArabicMatn = false) {
  const onSelectedChange = vi.fn();
  const onRequireArabicMatnChange = vi.fn();
  render(
    <SourcePicker
      selected={selected}
      onSelectedChange={onSelectedChange}
      requireArabicMatn={requireArabicMatn}
      onRequireArabicMatnChange={onRequireArabicMatnChange}
      t={t}
    />,
  );
  return { onSelectedChange, onRequireArabicMatnChange };
}

const openPopover = () => fireEvent.click(screen.getByRole("button", { name: en["research.sources_label"] }));

// The popover's first checkbox is the Arabic-matn-only toggle, not a source —
// tests that index into "the source checkboxes" need it excluded.
const getSourceCheckboxes = () => screen.getAllByRole("checkbox").slice(1) as HTMLInputElement[];

describe("SourcePicker", () => {
  it("reads as 'All sources' and shows everything checked by default", () => {
    setup([]);
    expect(screen.getByText(en["research.sources_all"])).toBeInTheDocument();

    openPopover();
    const boxes = getSourceCheckboxes();
    expect(boxes).toHaveLength(RESEARCH_SOURCES.length);
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it("keeps the other sources when the first one is unchecked", () => {
    const { onSelectedChange } = setup([]);
    openPopover();

    fireEvent.click(getSourceCheckboxes()[0]);

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

    fireEvent.click(getSourceCheckboxes()[0]);
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

describe("SourcePicker Arabic-matn-only toggle (Corpus Atlas finding #7)", () => {
  it("toggles requireArabicMatn independently of the source selection", () => {
    const { onRequireArabicMatnChange } = setup([]);
    openPopover();

    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(en["research.arabic_matn_only"]) }));
    expect(onRequireArabicMatnChange).toHaveBeenCalledWith(true);
  });

  it("shows the reset control when only the Arabic filter is on, sources otherwise untouched", () => {
    // Narrowing is not just "fewer sources" — turning on Arabic-only with
    // every source still selected is itself a narrowing the reset must undo.
    const { onSelectedChange, onRequireArabicMatnChange } = setup([], true);
    openPopover();

    fireEvent.click(screen.getByRole("button", { name: en["research.sources_reset"] }));
    expect(onSelectedChange).toHaveBeenCalledWith([]);
    expect(onRequireArabicMatnChange).toHaveBeenCalledWith(false);
  });

  it("keeps the reset control hidden when neither axis is narrowed", () => {
    setup([], false);
    openPopover();
    expect(screen.queryByRole("button", { name: en["research.sources_reset"] })).not.toBeInTheDocument();
  });
});
