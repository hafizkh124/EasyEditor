import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import RedirectToWorkspace from "@/components/RedirectToWorkspace";

/**
 * UX-v1 P3 — `/editor` and `/editor/:documentId` survive only as bookmark
 * redirects now that the M1 page is gone. A bare `<Navigate to="/workspace">`
 * declared in the route table cannot see the incoming location, so it would
 * silently drop `:documentId` and `location.state` — exactly the handoff
 * content Research/OCR/Transcribe/Extract send through this path (see
 * editorHandoff.test.tsx for the consumer side of that contract).
 */

function Probe() {
  const location = useLocation();
  return (
    <div data-testid="landed" data-state={JSON.stringify(location.state ?? null)}>
      {location.pathname}
    </div>
  );
}

function renderRoute(initialPath: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: initialPath, state }]}>
      <Routes>
        <Route path="/editor" element={<RedirectToWorkspace />} />
        <Route path="/editor/:documentId" element={<RedirectToWorkspace />} />
        <Route path="/workspace" element={<Probe />} />
        <Route path="/workspace/:documentId" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RedirectToWorkspace", () => {
  it("redirects a bare /editor to /workspace", async () => {
    renderRoute("/editor");
    const landed = await screen.findByTestId("landed");
    expect(landed.textContent).toBe("/workspace");
  });

  it("carries the :documentId across to /workspace/:documentId", async () => {
    renderRoute("/editor/doc-42");
    const landed = await screen.findByTestId("landed");
    expect(landed.textContent).toBe("/workspace/doc-42");
  });

  it("preserves location.state — the handoff content from Research/OCR/Transcribe/Extract", async () => {
    renderRoute("/editor", { content: "<p>handed over</p>", source: "ocr" });
    const landed = await screen.findByTestId("landed");
    expect(JSON.parse(landed.dataset.state!)).toEqual({ content: "<p>handed over</p>", source: "ocr" });
  });
});
