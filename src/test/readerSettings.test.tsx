import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useReaderSettings } from "@/hooks/useReaderSettings";

describe("reader theme settings", () => {
  beforeEach(() => window.localStorage.removeItem("reader.settings.v1"));

  it("defaults to auto and inherits application colour tokens", () => {
    const { result } = renderHook(() => useReaderSettings());

    expect(result.current.theme).toBe("auto");
    expect(result.current.styleProps).not.toHaveProperty("--reader-theme-bg");
    expect(result.current.styleProps).not.toHaveProperty("--reader-theme-fg");
  });

  it("preserves an existing explicit light preference", () => {
    window.localStorage.setItem("reader.settings.v1", JSON.stringify({ theme: "light" }));
    const { result } = renderHook(() => useReaderSettings());

    expect(result.current.theme).toBe("light");
    expect(result.current.styleProps["--reader-theme-bg"]).toBe("#ffffff");
  });

  it("removes explicit colours when switched back to auto", () => {
    const { result } = renderHook(() => useReaderSettings());
    act(() => result.current.update({ theme: "dark" }));
    expect(result.current.styleProps).toHaveProperty("--reader-theme-bg");

    act(() => result.current.update({ theme: "auto" }));
    expect(result.current.styleProps).not.toHaveProperty("--reader-theme-bg");
  });
});
