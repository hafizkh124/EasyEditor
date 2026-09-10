import React, { useCallback, useRef, useState } from "react";

/**
 * Plan §5.4 — ~60-line wheel-zoom + drag-pan wrapper, no dependency. Used inside
 * the artifact fullscreen dialog for a large sanad tree.
 */
export const PanZoom: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.min(6, Math.max(0.2, s * (e.deltaY < 0 ? 1.1 : 0.9))));
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  };
  const onPointerUp = () => { drag.current = null; };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-background"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{ cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
    >
      <div
        className="absolute origin-center"
        // Physical centring math (like WorkspaceLayout's drawerStyle) — a
        // transform, so it is kept as an inline style, not a logical utility.
        style={{ left: "50%", top: "50%", transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
      >
        {children}
      </div>
      <div className="absolute bottom-2 end-2 flex gap-1">
        <button className="rounded bg-muted px-2 py-1 text-xs" onClick={() => setScale((s) => Math.min(6, s * 1.2))}>+</button>
        <button className="rounded bg-muted px-2 py-1 text-xs" onClick={() => setScale((s) => Math.max(0.2, s / 1.2))}>−</button>
        <button className="rounded bg-muted px-2 py-1 text-xs" onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}>⤢</button>
      </div>
    </div>
  );
};
