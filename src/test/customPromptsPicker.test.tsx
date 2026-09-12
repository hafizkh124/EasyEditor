import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/**
 * M12 Phase H — CustomPromptsPicker, the `+` hub's "Prompts" row (ADR-0047).
 * Pins the actual fix: `showPrompts`/`onOpenPrompts` were wired in
 * AgentComposer.tsx to nothing (`showPrompts={false}`, no handler at all);
 * this is now a real list backed by customPromptService, insertable into
 * the composer.
 */
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const list = vi.fn();
vi.mock("@/lib/tasks/customPrompts", () => ({
  customPromptService: { list: (...args: unknown[]) => list(...args) },
}));

import { CustomPromptsPicker } from "@/components/composer/CustomPromptsPicker";
import type { CustomPromptRow } from "@/lib/tasks/customPrompts";

function row(partial: Partial<CustomPromptRow> = {}): CustomPromptRow {
  return {
    id: "prompt-1",
    user_id: "user-1",
    slug: "fiqhi-style",
    label: "فقہی اسلوب",
    system_prompt: "Rewrite the passage in classical fiqhi register.",
    base_task_slug: "formalize",
    scope: "either",
    apply_mode: "inline",
    output_format: "text",
    chunkable: true,
    produces_sources: false,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CustomPromptsPicker", () => {
  it("shows a loading state, then the empty hint when there are no rows", async () => {
    list.mockResolvedValue([]);
    render(<CustomPromptsPicker onInsert={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(await screen.findByText(/no custom prompts yet/i)).toBeInTheDocument();
  });

  it("lists every row with its label and instruction preview", async () => {
    list.mockResolvedValue([
      row(),
      row({ id: "prompt-2", slug: "other", label: "Other prompt", system_prompt: "Summarize in three bullet points." }),
    ]);
    render(<CustomPromptsPicker onInsert={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("فقہی اسلوب")).toBeInTheDocument();
    expect(screen.getByText("Other prompt")).toBeInTheDocument();
    expect(screen.getByText(/classical fiqhi register/)).toBeInTheDocument();
    expect(screen.getByText(/three bullet points/)).toBeInTheDocument();
  });

  it("inserts the clicked row's instruction text and closes", async () => {
    list.mockResolvedValue([row()]);
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(<CustomPromptsPicker onInsert={onInsert} onClose={onClose} />);
    fireEvent.click(await screen.findByText("فقہی اسلوب"));
    expect(onInsert).toHaveBeenCalledWith("Rewrite the passage in classical fiqhi register.");
    expect(onClose).toHaveBeenCalled();
  });

  it("falls back to the empty state if the list call rejects, rather than hanging", async () => {
    list.mockRejectedValue(new Error("offline"));
    render(<CustomPromptsPicker onInsert={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/no custom prompts yet/i)).toBeInTheDocument();
  });
});
