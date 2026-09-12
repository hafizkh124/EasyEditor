import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRef } from "react";

/**
 * M12 Phase F — ArtifactToolbar. Pins the actual bug (`table` claimed PNG/SVG
 * export via `isVisual` but a table artifact has no `<svg>` for `exportAs` to
 * find, so the buttons silently no-op'd) and its fix: table artifacts get a
 * dedicated Share Card button instead, wired to the real ShareCard + PNG
 * pipeline.
 */

// vi.mock factories are hoisted above every import/const in this file — the
// mock fns they reference must be created through vi.hoisted so they exist
// by the time the hoisted vi.mock calls run.
const { loadEditorFont, svgElementToPng, svgElementToBlob, downloadBlob } = vi.hoisted(() => ({
  loadEditorFont: vi.fn(async (_id: string) => undefined),
  svgElementToPng: vi.fn(async (_el: SVGSVGElement, _scale?: number) => new Blob(["png"], { type: "image/png" })),
  svgElementToBlob: vi.fn((_el: SVGSVGElement) => new Blob(["svg"], { type: "image/svg+xml" })),
  downloadBlob: vi.fn((_blob: Blob, _name: string) => undefined),
}));

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));
vi.mock("@/core/workspace/WorkspaceContext", () => ({
  useOptionalWorkspace: () => null,
}));
vi.mock("@/lib/fonts", () => ({ loadEditorFont }));
vi.mock("@/lib/export/svgExport", () => ({ svgElementToPng, svgElementToBlob, downloadBlob }));
vi.mock("@/lib/export/copyRich", () => ({ copyRich: vi.fn(async () => true) }));

import { ArtifactToolbar } from "@/components/workspace/artifacts/ArtifactToolbar";
import type { ArtifactState } from "@/components/workspace/agentArtifactState";

const tableArtifact: ArtifactState = {
  id: "a1",
  title: "حسابِ زکوٰۃ",
  type: "table",
  status: "final",
  table: { columns: ["مد", "رقم"], rows: [["نقد", "100000"]] },
};

const treeArtifact: ArtifactState = {
  id: "a2",
  title: "شجرۂ اسناد",
  type: "sanad-tree",
  status: "final",
};

const bodyRef = () => createRef<HTMLDivElement>();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ArtifactToolbar — isVisual no longer claims 'table' (the fixed bug)", () => {
  it("a table artifact shows the Share Card button, NOT the raw PNG/SVG export buttons", () => {
    render(<ArtifactToolbar artifact={tableArtifact} bodyRef={bodyRef()} />);
    expect(screen.getByTitle("Share card (PNG)")).toBeInTheDocument();
    expect(screen.queryByTitle("Export PNG")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Export SVG")).not.toBeInTheDocument();
  });

  it("a sanad-tree artifact still shows the raw PNG/SVG export buttons, not the Share Card one", () => {
    render(<ArtifactToolbar artifact={treeArtifact} bodyRef={bodyRef()} />);
    expect(screen.getByTitle("Export PNG")).toBeInTheDocument();
    expect(screen.getByTitle("Export SVG")).toBeInTheDocument();
    expect(screen.queryByTitle("Share card (PNG)")).not.toBeInTheDocument();
  });

  it("a table artifact with no .table data yet (still building) shows neither export button", () => {
    render(<ArtifactToolbar artifact={{ ...tableArtifact, table: undefined }} bodyRef={bodyRef()} />);
    expect(screen.queryByTitle("Share card (PNG)")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Export PNG")).not.toBeInTheDocument();
  });
});

describe("ArtifactToolbar — Share Card click pipeline", () => {
  it("loads the Nastaliq font, rasterises the off-screen ShareCard, and downloads a PNG named after the artifact", async () => {
    render(<ArtifactToolbar artifact={tableArtifact} bodyRef={bodyRef()} />);
    fireEvent.click(screen.getByTitle("Share card (PNG)"));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(loadEditorFont).toHaveBeenCalledWith("nastaliq");
    expect(svgElementToPng).toHaveBeenCalledWith(expect.any(SVGSVGElement), 1); // scale 1 — already a real 1200×1200 card
    const [blob, name] = downloadBlob.mock.calls[0] as [Blob, string];
    expect(blob.type).toBe("image/png");
    expect(name).toBe("حسابِ زکوٰۃ.png");
  });

  it("still downloads even when the font fails to load (best-effort, never blocks the export)", async () => {
    loadEditorFont.mockRejectedValueOnce(new Error("offline"));
    render(<ArtifactToolbar artifact={tableArtifact} bodyRef={bodyRef()} />);
    fireEvent.click(screen.getByTitle("Share card (PNG)"));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
  });
});
