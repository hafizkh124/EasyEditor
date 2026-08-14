import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnnotationList } from "@/components/workspace/AnnotationList";
import { LibraryDocumentTree } from "@/components/workspace/LibraryDocumentTree";

/**
 * UX-v1 P6 — three named "weakest empty states" (bare one-liner, no icon, no
 * action). AnnotationList already used the shared EmptyState component but
 * with no description; LibraryDocumentTree's per-project "No documents" row
 * was plain text with no way to act on it. (BrowseTab.tsx was already
 * upgraded to the full model and needed no change.)
 */

describe("AnnotationList empty state", () => {
  it("explains how to add a note, not just that there are none", () => {
    render(<AnnotationList annotations={[]} onDeleteAnnotation={vi.fn()} />);
    expect(screen.getByText("No margin notes yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Select any text in the document — a box to add a note on it will appear here."),
    ).toBeInTheDocument();
  });
});

describe("LibraryDocumentTree per-project empty state", () => {
  it("is an actionable control, not a dead-end label", () => {
    const onCreateDocument = vi.fn();
    render(
      <LibraryDocumentTree
        projects={[{ id: "p1", title: "Project One", kind: "general" } as any]}
        docsMap={{ p1: [] }}
        activeDocumentId={null}
        loading={false}
        searchQuery=""
        searchResults={[]}
        onSelectDocument={vi.fn()}
        onCreateDocument={onCreateDocument}
        onCreateProject={vi.fn()}
      />,
    );

    const trigger = screen.getByText("No documents yet — tap to create one");
    fireEvent.click(trigger);
    expect(onCreateDocument).toHaveBeenCalledWith("p1");
  });
});
