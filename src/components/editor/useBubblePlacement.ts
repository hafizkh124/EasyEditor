import { useState, useEffect, useLayoutEffect, useCallback, type RefObject } from "react";
import type { Editor } from "@tiptap/react";

/** Where the selection sits, in coordinates relative to the editor container. */
export interface Anchor {
  selCenter: number;
  selTop: number;
  selBottom: number;
  containerW: number;
  containerH: number;
  text: string;
}

export interface Placement {
  top: number;
  left: number;
  /** Container width, so the bar can cap its own max-width and wrap instead of overflowing. */
  containerW: number;
  text: string;
}

const EDGE = 8;
const GAP = 8;

/**
 * Clamp the bar against the container given its measured size.
 *
 * Pure and exported so the "must never leave the editor area" guarantee can be
 * tested directly, at sizes that are awkward to reproduce through the editor.
 */
export function computePlacement(
  anchor: Anchor,
  barW: number,
  barH: number,
): { top: number; left: number } {
  // Prefer above the selection; drop below only when it would not fit.
  let top = anchor.selTop - barH - GAP;
  if (top < EDGE) top = anchor.selBottom + GAP;
  // And never let it run past the bottom of the container.
  top = Math.max(0, Math.min(top, Math.max(0, anchor.containerH - barH - EDGE)));

  // `left` is the bar's left edge (no translate), so the clamp is exact and
  // behaves identically in RTL.
  const maxLeft = anchor.containerW - barW - EDGE;
  let left = anchor.selCenter - barW / 2;
  left = maxLeft < EDGE
    ? Math.max(0, (anchor.containerW - barW) / 2) // wider than the container: centre it
    : Math.min(Math.max(left, EDGE), maxLeft);

  return { top, left };
}

/**
 * Tracks the selection and returns a position that is clamped against the
 * *measured* size of the bar.
 *
 * The previous implementation clamped the selection's centre point and then
 * shifted the bar by `translateX(-50%)`, so half of a wide bar still hung off
 * the edge, and it reserved a hardcoded 44px above the selection — wrong as
 * soon as the bar is more than one row tall. Measuring the real element makes
 * both axes exact and keeps the bar on screen wherever the user clicks.
 */
export function useBubblePlacement(
  editor: Editor | null,
  barRef: RefObject<HTMLElement>,
): Placement | null {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const readAnchor = useCallback(() => {
    if (!editor) {
      setAnchor(null);
      return;
    }
    const { from, to, empty } = editor.state.selection;
    if (empty || to <= from) {
      setAnchor((prev) => (prev === null ? prev : null));
      return;
    }
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) {
      setAnchor((prev) => (prev === null ? prev : null));
      return;
    }

    const dom = editor.view.dom;
    const container = dom.closest(".relative") || dom.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);

    const next: Anchor = {
      selCenter: (start.left + end.left) / 2 - rect.left,
      selTop: Math.min(start.top, end.top) - rect.top,
      selBottom: Math.max(start.bottom, end.bottom) - rect.top,
      containerW: rect.width,
      containerH: rect.height,
      text,
    };

    setAnchor((prev) => {
      // `transaction` fires on every keystroke; returning the previous object
      // when nothing moved keeps the editor from re-rendering as the user types.
      if (
        prev && prev.text === next.text
        && Math.abs(prev.selCenter - next.selCenter) < 1
        && Math.abs(prev.selTop - next.selTop) < 1
        && Math.abs(prev.selBottom - next.selBottom) < 1
        && Math.abs(prev.containerW - next.containerW) < 1
      ) return prev;
      return next;
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on("selectionUpdate", readAnchor);
    editor.on("transaction", readAnchor);
    // A viewport or panel resize changes what "on screen" means, so re-place.
    window.addEventListener("resize", readAnchor);
    return () => {
      editor.off("selectionUpdate", readAnchor);
      editor.off("transaction", readAnchor);
      window.removeEventListener("resize", readAnchor);
    };
  }, [editor, readAnchor]);

  // Measured after paint, so `barW`/`barH` reflect however many rows the bar
  // actually wrapped into at this width.
  useLayoutEffect(() => {
    if (!anchor) {
      setPlacement((prev) => (prev === null ? prev : null));
      return;
    }
    const el = barRef.current;
    const { top, left } = computePlacement(anchor, el?.offsetWidth ?? 0, el?.offsetHeight ?? 0);

    setPlacement((prev) => {
      if (
        prev && prev.text === anchor.text
        && Math.abs(prev.top - top) < 0.5
        && Math.abs(prev.left - left) < 0.5
        && Math.abs(prev.containerW - anchor.containerW) < 0.5
      ) return prev;
      return { top, left, containerW: anchor.containerW, text: anchor.text };
    });
  }, [anchor, barRef]);

  return anchor ? (placement ?? { top: 0, left: 0, containerW: anchor.containerW, text: anchor.text }) : null;
}
