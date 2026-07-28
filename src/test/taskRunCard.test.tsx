import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskRunCard, type LastRunSummary } from "@/components/workspace/TaskRunCard";

/**
 * SPEC-M3 FR-4.5 / FR-5.9 — the card that appears under the Canvas after a run.
 *
 * Its job is to be believable: show the sources the AI actually leaned on, never
 * imply a confidence nobody reported, and make the whole run reversible while
 * the change is still fresh.
 */

function summary(partial: Partial<LastRunSummary> = {}): LastRunSummary {
  return {
    taskLabel: "علمی حوالہ جات تلاش کریں",
    applied: 3,
    total: 3,
    failed: 0,
    skipped: 0,
    invalidated: 0,
    tokensSpent: 15,
    sources: [],
    confidence: null,
    cancelled: false,
    ...partial,
  };
}

describe("TaskRunCard", () => {
  it("shows no confidence badge when the run reported none", () => {
    render(<TaskRunCard summary={summary()} onUndo={vi.fn()} onDismiss={vi.fn()} />);
    // FR-4.4: a spell-check or harakat run must not display a percentage.
    expect(screen.queryByText(/اعتماد/)).not.toBeInTheDocument();
  });

  it("bands a low confidence as something to check rather than a bare number", () => {
    render(<TaskRunCard summary={summary({ confidence: 0.3 })} onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/کم اعتماد — جانچ لیں \(30%\)/)).toBeInTheDocument();
  });

  it("uses the same 70% threshold the retrieval gate uses", () => {
    render(<TaskRunCard summary={summary({ confidence: 0.7 })} onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/اعلیٰ اعتماد \(70%\)/)).toBeInTheDocument();
  });

  it("reports skipped blocks so an untouched table is visible, not silent", () => {
    render(
      <TaskRunCard summary={summary({ skipped: 2, failed: 1 })} onUndo={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText(/1 حصے ناکام/)).toBeInTheDocument();
    expect(screen.getByText(/2 بلاک/)).toBeInTheDocument();
  });

  it("renders retrieved sources and links only what the corpus supplied", () => {
    render(
      <TaskRunCard
        summary={summary({
          confidence: 0.8,
          sources: [
            {
              domain: "sunnah",
              reference: "Sahih al-Bukhari #1",
              citation_ref: { collection: "Sahih al-Bukhari", hadith_number: 1 },
              source_url: "https://sunnah.com/bukhari:1",
              snippet: "إنما الأعمال بالنيات",
            },
            {
              domain: "shamela-index",
              reference: "الرسالة",
              citation_ref: { title: "الرسالة" },
              source_url: null,
              snippet: "نص من الرسالة",
            },
          ],
        })}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("إنما الأعمال بالنيات")).toBeInTheDocument();
    // The URL-less source must not acquire an invented link.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("exposes undo and dismiss as separate, named actions", () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(<TaskRunCard summary={summary()} onUndo={onUndo} onDismiss={onDismiss} />);

    screen.getByRole("button", { name: "اس پورے رن کی تبدیلیاں واپس لیں" }).click();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "یہ کارڈ بند کریں" }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("says the run was cancelled instead of implying it finished", () => {
    render(
      <TaskRunCard
        summary={summary({ cancelled: true, applied: 5, total: 20 })}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/منسوخ/)).toBeInTheDocument();
    expect(screen.getByText(/5 از 20 مکمل/)).toBeInTheDocument();
  });
});
