import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { OfflineBanner } from "@/components/OfflineBanner";

afterEach(cleanup);

describe("OfflineBanner", () => {
  it("is silent while online, warns when the connection drops, and confirms when it returns", () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByRole("status").textContent).toMatch(/offline/i);

    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.getByRole("status").textContent).toMatch(/back online/i);
  });
});
