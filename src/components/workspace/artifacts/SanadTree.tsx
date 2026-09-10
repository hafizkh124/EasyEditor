import React, { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/contexts/LanguageContext";
import { resolveNarratorNames, type ResolvedNarrator } from "@/lib/jkhssn/resolveNames";
import { layoutForest } from "./treeLayout";
import { NarratorCard } from "./NarratorCard";
import type { SanadTreePayload, SanadTreeNode } from "../../../../shared/jkhssn/types";

/**
 * Plan §5.5 — the isnād tree. Input is `axisSanadTree`'s `data` payload (ids +
 * flags only); names come from `resolveNarratorNames` on mount. RTL: the tree
 * is rooted on the `end` side and grows toward `start` (x mirrored).
 *
 * A failed name lookup shows "نام دستیاب نہیں" — never a blank node.
 */

const NODE_W = 132;
const NODE_H = 34;
const GAP_X = 26;
const GAP_Y = 58;

type NodeKind = "marfu" | "mawquf" | "maqtu" | "plain";

function kindOf(n: SanadTreeNode): NodeKind {
  if (n.isMarfoa) return "marfu";
  if (n.isMawkof) return "mawquf";
  if (n.isMaktoa) return "maqtu";
  return "plain";
}

const KIND_FILL: Record<NodeKind, string> = {
  marfu: "var(--jk-marfu, #16a34a)",
  mawquf: "var(--jk-mawquf, #2563eb)",
  maqtu: "var(--jk-maqtu, #9333ea)",
  plain: "var(--muted-foreground, #64748b)",
};

export const SanadTree: React.FC<{ payload: SanadTreePayload; forwardRef?: React.Ref<SVGSVGElement> }> = ({ payload, forwardRef }) => {
  const { t, direction } = useLanguage();
  const rtl = direction === "rtl";
  const [names, setNames] = useState<Map<number, ResolvedNarrator>>(new Map());
  const [loadingNames, setLoadingNames] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoadingNames(true);
    resolveNarratorNames(payload.rawyIds ?? [])
      .then((m) => { if (alive) setNames(m); })
      .finally(() => { if (alive) setLoadingNames(false); });
    return () => { alive = false; };
  }, [payload.rawyIds]);

  // Merge every chain into one forest (dedup nodes by id — a narrator shared
  // across chains renders once).
  const { laid, edges, viewW, viewH } = useMemo(() => {
    const seen = new Map<number, SanadTreeNode>();
    for (const chain of payload.chains ?? []) {
      for (const n of chain.nodes) if (!seen.has(n.id)) seen.set(n.id, n);
    }
    const input = [...seen.values()].map((n) => ({ id: n.id, parentId: n.parentId, data: n }));
    const res = layoutForest(input);
    const w = (res.width + 1) * (NODE_W + GAP_X) + GAP_X;
    const h = (res.maxDepth + 1) * (NODE_H + GAP_Y) + GAP_Y;
    return { laid: res.nodes, edges: res.edges, viewW: Math.max(w, 240), viewH: Math.max(h, 160) };
  }, [payload.chains]);

  const px = (x: number) => {
    const raw = GAP_X + x * (NODE_W + GAP_X);
    return rtl ? viewW - raw - NODE_W : raw;
  };
  const py = (depth: number) => GAP_Y + depth * (NODE_H + GAP_Y);

  const label = (n: SanadTreeNode): { text: string; unknown: boolean } => {
    if (n.jkRawyId == null) return { text: t("jkhssn.sanad_end", "— (نبی ﷺ)"), unknown: false };
    const r = names.get(n.jkRawyId);
    if (r?.shuhraAr || r?.nameAr) return { text: r.shuhraAr || r.nameAr!, unknown: false };
    return { text: loadingNames ? "…" : t("jkhssn.name_unavailable", "نام دستیاب نہیں"), unknown: !loadingNames };
  };

  const nodeMap = new Map(laid.map((n) => [n.id, n]));

  return (
    <div className="w-full overflow-auto" dir={rtl ? "rtl" : "ltr"}>
      <svg
        ref={forwardRef}
        viewBox={`0 0 ${viewW} ${viewH}`}
        width={viewW}
        height={viewH}
        className="max-w-none"
        role="img"
        aria-label={t("jkhssn.sanad_tree", "شجرۂ اسناد")}
      >
        {/* links */}
        {edges.map(({ from, to }, i) => {
          const a = nodeMap.get(from);
          const b = nodeMap.get(to);
          if (!a || !b) return null;
          const x1 = px(a.x) + NODE_W / 2;
          const y1 = py(a.depth) + NODE_H;
          const x2 = px(b.x) + NODE_W / 2;
          const y2 = py(b.depth);
          const my = (y1 + y2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
              fill="none"
              stroke="var(--border, #cbd5e1)"
              strokeWidth={1.5}
            />
          );
        })}
        {/* nodes */}
        {laid.map((ln) => {
          const n = ln.data;
          const { text, unknown } = label(n);
          const kind = kindOf(n);
          const x = px(ln.x);
          const y = py(ln.depth);
          return (
            <Popover key={ln.id}>
              <PopoverTrigger asChild>
                <g style={{ cursor: n.jkRawyId != null ? "pointer" : "default" }} tabIndex={0} role="button">
                  <rect
                    x={x} y={y} width={NODE_W} height={NODE_H} rx={6}
                    fill="var(--card, #fff)"
                    stroke={KIND_FILL[kind]}
                    strokeWidth={2}
                  />
                  <text
                    x={x + NODE_W / 2}
                    y={y + NODE_H / 2 + 4}
                    textAnchor="middle"
                    fontSize={12}
                    fill={unknown ? "var(--muted-foreground, #94a3b8)" : "var(--foreground, #0f172a)"}
                    style={{ direction: "rtl", unicodeBidi: "plaintext" }}
                  >
                    {text.length > 18 ? text.slice(0, 17) + "…" : text}
                  </text>
                </g>
              </PopoverTrigger>
              {n.jkRawyId != null && (
                <PopoverContent className="w-80 p-0" collisionPadding={12}>
                  <NarratorCard variant="popover" resolved={names.get(n.jkRawyId) ?? null} />
                </PopoverContent>
              )}
            </Popover>
          );
        })}
      </svg>

      {/* legend */}
      <div className="mt-2 flex flex-wrap gap-3 px-1 text-xs text-muted-foreground">
        {([["marfu", t("jkhssn.marfu", "مرفوع")], ["mawquf", t("jkhssn.mawquf", "موقوف")], ["maqtu", t("jkhssn.maqtu", "مقطوع")]] as const).map(([k, lbl]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: KIND_FILL[k as NodeKind] }} />
            {lbl}
          </span>
        ))}
      </div>
    </div>
  );
};
