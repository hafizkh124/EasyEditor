import { useCallback, useRef } from "react";

/**
 * Returns a wrapper that swallows successive calls within `cooldownMs` of the
 * last accepted call. Use it to debounce double-taps on submit-style buttons
 * where the visible disabled state lags the click (e.g. async handler that
 * doesn't flip a flag until the next render).
 *
 * SPEC-v2 §7 Phase 6: "Client-side debounce on submit buttons."
 */
export function useSubmitGuard(cooldownMs: number = 400) {
  const lastFiredRef = useRef<number>(0);

  return useCallback(
    <Args extends unknown[]>(fn: (...args: Args) => void) =>
      (...args: Args) => {
        const now = Date.now();
        if (now - lastFiredRef.current < cooldownMs) return;
        lastFiredRef.current = now;
        fn(...args);
      },
    [cooldownMs],
  );
}
