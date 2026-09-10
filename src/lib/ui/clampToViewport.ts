import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Plan §4.3 / §6 — keep a hand-rolled popover fully on-screen. The picker and
 * the `+` hub are absolutely-positioned divs (not Radix), so nothing flips or
 * clamps them automatically. This measures the element after it renders and
 * returns a `translate(x, y)` correction that pulls it back inside the viewport
 * with a small padding.
 */
export function useClampToViewport(
  ref: RefObject<HTMLElement>,
  deps: readonly unknown[] = [],
  padding = 12,
): { transform: string } {
  const [transform, setTransform] = useState("translate(0px, 0px)");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset before measuring so a previous correction doesn't compound.
    el.style.transform = "translate(0px, 0px)";
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let dx = 0;
    let dy = 0;
    if (r.right > vw - padding) dx = vw - padding - r.right;
    if (r.left + dx < padding) dx += padding - (r.left + dx);
    if (r.bottom > vh - padding) dy = vh - padding - r.bottom;
    if (r.top + dy < padding) dy += padding - (r.top + dy);

    setTransform(`translate(${Math.round(dx)}px, ${Math.round(dy)}px)`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { transform };
}
