import { describe, it, expect } from "vitest";
import { layoutForest } from "@/components/workspace/artifacts/treeLayout";

describe("layoutForest", () => {
  it("lays a linear chain out one node per depth", () => {
    const res = layoutForest([
      { id: 1, parentId: null, data: "a" },
      { id: 2, parentId: 1, data: "b" },
      { id: 3, parentId: 2, data: "c" },
    ]);
    expect(res.maxDepth).toBe(2);
    expect(res.nodes.map((n) => n.depth).sort()).toEqual([0, 1, 2]);
    expect(res.edges).toEqual([{ from: 1, to: 2 }, { from: 2, to: 3 }]);
  });

  it("centres a parent over its two children", () => {
    const res = layoutForest([
      { id: 1, parentId: null, data: "root" },
      { id: 2, parentId: 1, data: "l" },
      { id: 3, parentId: 1, data: "r" },
    ]);
    const byId = new Map(res.nodes.map((n) => [n.id, n]));
    expect(byId.get(1)!.x).toBeCloseTo((byId.get(2)!.x + byId.get(3)!.x) / 2);
  });

  it("treats an orphan (missing parent) as a root", () => {
    const res = layoutForest([
      { id: 5, parentId: 99, data: "x" },
      { id: 6, parentId: 5, data: "y" },
    ]);
    expect(res.nodes.find((n) => n.id === 5)!.depth).toBe(0);
  });
});
