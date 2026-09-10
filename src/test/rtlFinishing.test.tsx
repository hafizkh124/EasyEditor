// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

/**
 * Plan §6 — RTL/LTR finishing. Two guarantees:
 *  1. every Phase 3–5 new component file is free of physical-direction
 *     Tailwind utilities and hard-coded left/right inline styles (bar the one
 *     documented transform in PanZoom);
 *  2. the sanad-tree SVG genuinely mirrors — a node's x flips between ltr/rtl.
 */

// ── 1. static audit ─────────────────────────────────────────────────────────
const PHASE_DIRS = [
  "src/components/workspace/artifacts",
  "src/components/workspace/rail",
];
const PHASE_FILES = [
  "src/components/workspace/AgentComposer.tsx",
  "src/components/workspace/ScopeReviewDialog.tsx",
  "src/components/workspace/WorkspaceStatusBar.tsx",
  "src/components/workspace/AgentArtifactPanel.tsx",
];

const PHYSICAL = /\b(?:[mp][lr]-\d|border-[lr]-|text-(?:left|right)|float-(?:left|right)|(?:top|bottom)-auto|(?:^|\s)(?:left|right)-\d)/;

function collect(): string[] {
  const files: string[] = [...PHASE_FILES];
  for (const d of PHASE_DIRS) {
    for (const f of fs.readdirSync(path.resolve(d))) {
      if (f.endsWith(".tsx") || f.endsWith(".ts")) files.push(`${d}/${f}`);
    }
  }
  return files;
}

describe("Phase 3–5 files are logical-direction only", () => {
  for (const rel of collect()) {
    it(rel, () => {
      const src = fs.readFileSync(path.resolve(rel), "utf8");
      const offenders: string[] = [];
      src.split("\n").forEach((line, i) => {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
        // PanZoom documents its centring transform.
        if (rel.endsWith("PanZoom.tsx") && line.includes('left: "50%"')) return;
        if (PHYSICAL.test(line)) offenders.push(`${i + 1}: ${line.trim()}`);
      });
      expect(offenders).toEqual([]);
    });
  }
});

// ── 2. sanad-tree mirrors ───────────────────────────────────────────────────
const dir = { value: "rtl" as "rtl" | "ltr" };
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, direction: dir.value, language: "ur" }),
}));
vi.mock("@/lib/jkhssn/resolveNames", () => ({ resolveNarratorNames: () => Promise.resolve(new Map()) }));
vi.mock("@/core/workspace/WorkspaceContext", () => ({ useOptionalWorkspace: () => null }));

import { SanadTree } from "@/components/workspace/artifacts/SanadTree";
import type { SanadTreePayload } from "../../shared/jkhssn/types";

const payload: SanadTreePayload = {
  chains: [{ chainId: 1, bookId: 1, sanadType: 0, nodes: [
    { id: 1, parentId: null, jkRawyId: 10, isLeaf: false, isMarfoa: true, isMawkof: false, isMaktoa: false },
    { id: 2, parentId: 1, jkRawyId: 11, isLeaf: true, isMarfoa: false, isMawkof: false, isMaktoa: false },
  ] }],
  rawyIds: [10, 11],
};

async function firstRectX(): Promise<number> {
  await waitFor(() => expect(document.querySelector("svg rect")).toBeTruthy());
  return Number(document.querySelector("svg rect")!.getAttribute("x"));
}

describe("SanadTree RTL mirror", () => {
  beforeEach(() => cleanup());

  it("flips a node's x between ltr and rtl", async () => {
    dir.value = "ltr";
    const { unmount } = render(<SanadTree payload={payload} />);
    const ltrX = await firstRectX();
    unmount();
    cleanup();

    dir.value = "rtl";
    render(<SanadTree payload={payload} />);
    const rtlX = await firstRectX();

    expect(ltrX).not.toBe(rtlX);
  });

  it("sets dir on the scroll container in rtl", async () => {
    dir.value = "rtl";
    render(<SanadTree payload={payload} />);
    await waitFor(() => expect(document.querySelector("svg")).toBeTruthy());
    expect(screen.getByRole("img").closest("[dir]")?.getAttribute("dir")).toBe("rtl");
  });
});
