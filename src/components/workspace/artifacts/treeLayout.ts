/**
 * Plan §5.5 — a tiny tidy-tree layout (Reingold–Tilford, first/second walk).
 * Hand-rolled so the sanad-tree needs no `d3-hierarchy` dependency.
 */
export interface LayoutInput<T> {
  id: number;
  parentId: number | null;
  data: T;
}

export interface LaidOutNode<T> {
  id: number;
  parentId: number | null;
  data: T;
  /** depth from the root (0-based). */
  depth: number;
  /** sibling coordinate (arbitrary units; caller scales). */
  x: number;
}

export interface LayoutResult<T> {
  nodes: LaidOutNode<T>[];
  /** parent id → child ids, in order. */
  edges: Array<{ from: number; to: number }>;
  maxDepth: number;
  width: number;
}

/**
 * Lay out a forest. Multiple roots are stacked along the x-axis with a gap.
 * `x` is assigned so leaves are evenly spaced and each internal node sits at
 * the midpoint of its children.
 */
export function layoutForest<T>(input: LayoutInput<T>[]): LayoutResult<T> {
  const byId = new Map(input.map((n) => [n.id, n]));
  const children = new Map<number, number[]>();
  const roots: number[] = [];
  for (const n of input) {
    if (n.parentId == null || !byId.has(n.parentId)) {
      roots.push(n.id);
    } else {
      const arr = children.get(n.parentId) ?? [];
      arr.push(n.id);
      children.set(n.parentId, arr);
    }
  }

  const out = new Map<number, LaidOutNode<T>>();
  const edges: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  let maxDepth = 0;

  const walk = (id: number, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const kids = children.get(id) ?? [];
    let x: number;
    if (kids.length === 0) {
      x = cursor;
      cursor += 1;
    } else {
      const xs = kids.map((k) => {
        edges.push({ from: id, to: k });
        return walk(k, depth + 1);
      });
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    out.set(id, { id, parentId: byId.get(id)!.parentId, data: byId.get(id)!.data, depth, x });
    return x;
  };

  for (const r of roots) {
    walk(r, 0);
    cursor += 1; // gap between roots
  }

  const nodes = [...out.values()];
  const width = nodes.length ? Math.max(...nodes.map((n) => n.x)) : 0;
  return { nodes, edges, maxDepth, width };
}
