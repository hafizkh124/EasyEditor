// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_k: string, fb?: string) => fb ?? _k, direction: "rtl", language: "ur" }),
}));

const resolveNarratorNames = vi.fn((_ids: number[]) => Promise.resolve(new Map()));
vi.mock("@/lib/jkhssn/resolveNames", () => ({
  resolveNarratorNames: (ids: number[]) => resolveNarratorNames(ids),
}));

vi.mock("@/core/workspace/WorkspaceContext", () => ({ useOptionalWorkspace: () => null }));

import { SanadTree } from "@/components/workspace/artifacts/SanadTree";
import { NarratorCard } from "@/components/workspace/artifacts/NarratorCard";
import { MatnDiff } from "@/components/workspace/artifacts/MatnDiff";
import { ArtifactBody } from "@/components/workspace/artifacts/ArtifactBody";
import type { SanadTreePayload, NarratorCardPayload } from "../../shared/jkhssn/types";

const treePayload: SanadTreePayload = {
  chains: [
    {
      chainId: 1,
      bookId: 5,
      sanadType: 0,
      nodes: [
        { id: 1, parentId: null, jkRawyId: 10, isLeaf: false, isMarfoa: true, isMawkof: false, isMaktoa: false },
        { id: 2, parentId: 1, jkRawyId: 11, isLeaf: false, isMarfoa: false, isMawkof: false, isMaktoa: false },
        { id: 3, parentId: 2, jkRawyId: null, isLeaf: true, isMarfoa: false, isMawkof: false, isMaktoa: false },
      ],
    },
  ],
  rawyIds: [10, 11],
};

beforeEach(() => {
  resolveNarratorNames.mockClear();
  resolveNarratorNames.mockResolvedValue(new Map());
});

describe("SanadTree", () => {
  it("resolves names on mount and renders one <svg> with a node per narrator", async () => {
    render(<SanadTree payload={treePayload} />);
    await waitFor(() => expect(resolveNarratorNames).toHaveBeenCalledWith([10, 11]));
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    // 3 nodes → 3 <rect>
    expect(svg!.querySelectorAll("rect").length).toBe(3);
    // 2 parent→child links → 2 <path>
    expect(svg!.querySelectorAll("path").length).toBe(2);
  });

  it("shows the marfūʿ/mawqūf/maqṭūʿ legend", async () => {
    render(<SanadTree payload={treePayload} />);
    expect(await screen.findByText("مرفوع")).toBeTruthy();
    expect(screen.getByText("موقوف")).toBeTruthy();
  });

  it("falls back to a visible label when a name cannot be resolved", async () => {
    render(<SanadTree payload={treePayload} />);
    // names map stays empty → the two id-bearing nodes read "نام دستیاب نہیں"
    await waitFor(() => expect(screen.getAllByText("نام دستیاب نہیں").length).toBeGreaterThan(0));
  });
});

describe("NarratorCard", () => {
  const payload: NarratorCardPayload = {
    jkRawyId: 10, nameShapes: ["محمد بن مسلم بن شهاب الزهري"],
    deathYearNum: 124, tabaqaNum: 4, hadithsCount: 2200,
    tabaqa: "الطبقة الرابعة", birthYear: null, deathYear: "١٢٤ هـ",
    martabaIbnHajar: "الفقيه الحافظ متفق على جلالته وإتقانه",
    martabaZahabi: null, birthCity: null, deathCity: null, livingCity: "المدينة", mazhab: null,
    jarh: [{ verdict: "ثقة", criticSay: "أثبت الناس", criticId: 3 }],
    teachers: [{ id: 1, hadithsCount: null }], students: [{ id: 2, hadithsCount: null }],
    needsNames: [],
  };
  it("renders the merged fields + jarh + provenance in the stage variant", () => {
    render(<NarratorCard variant="stage" payload={payload} />);
    expect(screen.getByText("محمد بن مسلم بن شهاب الزهري")).toBeTruthy();
    expect(screen.getByText("ثقة")).toBeTruthy();
    expect(screen.getByText(/جوامع الكلم/)).toBeTruthy();
  });
  it("shows a fallback name when neither payload nor resolved has one", () => {
    render(<NarratorCard variant="popover" payload={null} resolved={null} />);
    expect(screen.getByText("نام دستیاب نہیں")).toBeTruthy();
  });
});

describe("MatnDiff", () => {
  it("diffs each variant against the base and marks the change", () => {
    render(
      <MatnDiff payload={{ variants: [
        { label: "البخاري", text: "العلم نور" },
        { label: "مسلم", text: "العلم ضياء" },
      ] }} />,
    );
    expect(screen.getByText("نور")).toBeTruthy();   // deleted from base
    expect(screen.getByText("ضياء")).toBeTruthy();  // inserted in variant
  });
  it("asks for two narrations when given one", () => {
    render(<MatnDiff payload={{ variants: [{ label: "x", text: "a" }] }} />);
    expect(screen.getByText(/کم از کم دو روایات/)).toBeTruthy();
  });
});

describe("ArtifactBody dispatch", () => {
  it("routes sanad-tree data to <SanadTree>", async () => {
    render(<ArtifactBody artifact={{ id: "a", title: "t", type: "sanad-tree", status: "final", data: treePayload }} />);
    await waitFor(() => expect(document.querySelector("svg")).toBeTruthy());
  });
  it("routes plain text to a <pre>", () => {
    render(<ArtifactBody artifact={{ id: "a", title: "t", type: "document", status: "final", text: "hello" }} />);
    expect(screen.getByText("hello").tagName).toBe("PRE");
  });
});
