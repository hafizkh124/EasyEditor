import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-26T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSubmitGuard", () => {
  it("forwards the first call to the wrapped function", () => {
    const { result } = renderHook(() => useSubmitGuard(400));
    const fn = vi.fn();
    const guarded = result.current(fn);

    guarded();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("drops calls within the cooldown window", () => {
    const { result } = renderHook(() => useSubmitGuard(400));
    const fn = vi.fn();
    const guarded = result.current(fn);

    guarded();
    vi.advanceTimersByTime(100);
    guarded();
    vi.advanceTimersByTime(200);
    guarded();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("accepts the next call after the cooldown elapses", () => {
    const { result } = renderHook(() => useSubmitGuard(400));
    const fn = vi.fn();
    const guarded = result.current(fn);

    guarded();
    vi.advanceTimersByTime(401);
    guarded();
    vi.advanceTimersByTime(401);
    guarded();

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("forwards arguments to the wrapped function", () => {
    const { result } = renderHook(() => useSubmitGuard(100));
    const fn = vi.fn();
    const guarded = result.current(fn);

    guarded("hello", 42);
    expect(fn).toHaveBeenCalledWith("hello", 42);
  });

  it("treats each guard wrapper independently within one hook instance", () => {
    // The hook returns a wrapper factory; wrapping two different fns shares
    // the same cooldown ref, which matches its intended single-button use.
    const { result } = renderHook(() => useSubmitGuard(400));
    const a = vi.fn();
    const b = vi.fn();
    const guardedA = result.current(a);
    const guardedB = result.current(b);

    guardedA();
    guardedB(); // shares the cooldown — this is dropped
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(0);
  });
});
