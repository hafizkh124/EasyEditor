// Virtualized list for the research chat (SPEC-v2 NFR-2 / Phase 5).
//
// Strategy: VariableSizeList with a ResizeObserver per row that writes the
// measured height into a cache and calls resetAfterIndex on change. New rows
// fall back to an estimated height until measured.
//
// Used only above a message-count threshold; below the threshold ChatDisplay
// renders flat to avoid measurement complexity for the common case.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { VariableSizeList, type ListOnItemsRenderedProps } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";

interface VirtualMessageListProps {
  count: number;
  renderItem: (index: number) => React.ReactNode;
  /** Stable key per row so the resize observer rebinds correctly on list mutations. */
  getKey: (index: number) => string | number;
  /** Default height used before a row is measured. */
  estimatedItemSize?: number;
  /** When true and the user is at the bottom, scroll to the last item on count changes. */
  followBottom?: boolean;
}

const VirtualMessageList = ({
  count,
  renderItem,
  getKey,
  estimatedItemSize = 120,
  followBottom = true,
}: VirtualMessageListProps) => {
  const listRef = useRef<VariableSizeList>(null);
  const heightCacheRef = useRef<Map<number, number>>(new Map());
  const isAtBottomRef = useRef(true);

  const getItemSize = useCallback(
    (i: number) => heightCacheRef.current.get(i) ?? estimatedItemSize,
    [estimatedItemSize],
  );

  // Reset measurements when the list shrinks (e.g., chat cleared) so stale
  // heights for indexes beyond the new count don't leak into future renders.
  useEffect(() => {
    for (const k of heightCacheRef.current.keys()) {
      if (k >= count) heightCacheRef.current.delete(k);
    }
  }, [count]);

  const onItemsRendered = useCallback((args: ListOnItemsRenderedProps) => {
    isAtBottomRef.current = args.visibleStopIndex >= count - 1;
  }, [count]);

  // Auto-scroll to the latest row when the count grows and we were already at the bottom.
  const lastCountRef = useRef(count);
  useLayoutEffect(() => {
    if (count > lastCountRef.current && followBottom && isAtBottomRef.current) {
      listRef.current?.scrollToItem(count - 1, "end");
    }
    lastCountRef.current = count;
  }, [count, followBottom]);

  const Row = useMemo(() => {
    const Inner = ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const innerRef = useRef<HTMLDivElement>(null);

      useLayoutEffect(() => {
        const el = innerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
          const h = entries[0].contentRect.height;
          if (!h || !Number.isFinite(h)) return;
          const cached = heightCacheRef.current.get(index);
          if (cached !== h) {
            heightCacheRef.current.set(index, h);
            // false = don't force a scroll position adjustment.
            listRef.current?.resetAfterIndex(index, false);
          }
        });
        ro.observe(el);
        return () => ro.disconnect();
      }, [index]);

      return (
        <div style={style}>
          <div ref={innerRef}>{renderItem(index)}</div>
        </div>
      );
    };
    return Inner;
  }, [renderItem]);

  return (
    <AutoSizer>
      {({ height, width }: { height: number; width: number }) => (
        <VariableSizeList
          ref={listRef}
          height={height}
          width={width}
          itemCount={count}
          itemKey={(i) => getKey(i)}
          itemSize={getItemSize}
          estimatedItemSize={estimatedItemSize}
          overscanCount={4}
          onItemsRendered={onItemsRendered}
        >
          {Row}
        </VariableSizeList>
      )}
    </AutoSizer>
  );
};

export default VirtualMessageList;
