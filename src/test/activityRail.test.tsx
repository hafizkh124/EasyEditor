import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivityRail } from "@/components/workspace/rail/ActivityRail";

const ws = {
  activeRailPanel: "library" as "files" | "library" | "history" | "settings" | null,
  toggleRailPanel: vi.fn(),
};
vi.mock("@/core/workspace/WorkspaceContext", () => ({ useWorkspace: () => ws }));
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ t: (_k: string, f: string) => f }) }));

const backend = { isDesktop: vi.fn(() => true) };
vi.mock("@/core/backend", () => ({ isDesktop: () => backend.isDesktop() }));

beforeEach(() => {
  vi.clearAllMocks();
  ws.activeRailPanel = "library";
  backend.isDesktop.mockReturnValue(true);
});

describe("ActivityRail", () => {
  it("shows all four icons on desktop and marks the active one", () => {
    render(<ActivityRail />);
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "History" })).not.toHaveAttribute("aria-current");
  });

  it("omits the Files icon on web", () => {
    backend.isDesktop.mockReturnValue(false);
    render(<ActivityRail />);
    expect(screen.queryByRole("button", { name: "Files" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Library" })).toBeInTheDocument();
  });

  it("toggles a panel on click", () => {
    render(<ActivityRail />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(ws.toggleRailPanel).toHaveBeenCalledWith("history");
  });
});
