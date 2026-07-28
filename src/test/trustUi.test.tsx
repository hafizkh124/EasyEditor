import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "@/core/workspace/WorkspaceContext";
import { TrustTab } from "@/components/workspace/TrustTab";
import { taskRunService } from "@/core/workspace/taskRunService";
import type { TaskRun } from "@/core/workspace/types";

/**
 * FR-4.3 / FR-4.4 — what the Trust tab is allowed to claim.
 *
 * The point of this surface is that a scholar can believe what it says, so the
 * assertions here are about NOT inventing numbers: no confidence badge unless a
 * run reported one, and the weakest score wins when several did.
 */

function run(partial: Partial<TaskRun>): TaskRun {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: "u1",
    task_slug: "spelling_check",
    status: "completed",
    created_at: new Date().toISOString(),
    ...partial,
  } as TaskRun;
}

function renderTrustTab() {
  return render(
    <MemoryRouter>
      {/* The provider takes the id as a prop — without it `activeDocumentId` is
          null, `fetchAuditData` returns early, and every assertion would be
          measuring the empty state instead of the mocked runs. */}
      <WorkspaceProvider documentId="doc-1">
        <TrustTab />
      </WorkspaceProvider>
    </MemoryRouter>,
  );
}

describe("TrustTab confidence reporting (M3 Pillar C)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows no confidence figure when nothing has reported one", async () => {
    vi.spyOn(taskRunService, "listTaskRuns").mockResolvedValue([
      run({ task_slug: "spelling_check", confidence: null, tokens_spent: 5 }),
    ]);

    renderTrustTab();

    await waitFor(() => {
      expect(screen.getByText("دستیاب نہیں")).toBeInTheDocument();
    });
    // A spell-check run must never produce a percentage (FR-4.4).
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it("reports the lowest confidence across runs, not the average", async () => {
    vi.spyOn(taskRunService, "listTaskRuns").mockResolvedValue([
      run({ task_slug: "citations", confidence: 0.9, tokens_spent: 5 }),
      run({ task_slug: "citations", confidence: 0.4, tokens_spent: 5 }),
    ]);

    renderTrustTab();

    // min = 40%, mean would have been 65% — the weakest source must win (FR-4.3).
    // JSX splits `{n}%` into two text nodes, hence the textContent matcher.
    const hasText = (needle: string) => (_: string, el: Element | null) =>
      el?.textContent?.trim() === needle;

    await waitFor(() => {
      expect(screen.getAllByText(hasText("40%")).length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText(hasText("65%"))).toHaveLength(0);
  });

  it("renders retrieved sources, and never a link the corpus did not supply", async () => {
    vi.spyOn(taskRunService, "listTaskRuns").mockResolvedValue([
      run({
        task_slug: "citations",
        confidence: 0.8,
        tokens_spent: 5,
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
            citation_ref: { title: "الرسالة", author: "الشافعي" },
            source_url: null,
            snippet: "نص من الرسالة",
          },
        ],
      }),
    ]);

    renderTrustTab();

    await waitFor(() => {
      expect(screen.getByText("إنما الأعمال بالنيات")).toBeInTheDocument();
    });

    // The source that has a URL gets a link; the one the corpus gave no URL for
    // must NOT get an invented one (FR-4.5).
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://sunnah.com/bukhari:1");
  });

  it("totals only the tokens that were actually spent", async () => {
    vi.spyOn(taskRunService, "listTaskRuns").mockResolvedValue([
      run({ tokens_spent: 5 }),
      run({ tokens_spent: 15 }),
    ]);

    renderTrustTab();

    await waitFor(() => {
      const totals = screen.getAllByText(
        (_, el) => el?.textContent?.trim() === "20 ٹوکنز",
      );
      expect(totals.length).toBeGreaterThan(0);
    });
  });
});
