import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * WorkspaceLayout deliberately has no sidebar (SPEC-M2 FR-1.4), and the TopBar
 * spec never listed a navigation control. The result was that a desktop user
 * who opened /workspace had no way back to the dashboard, the tools or their
 * profile — the only back button is mobile-only and Ctrl+K offers
 * workspace-internal actions only.
 *
 * This pins the exit down so it cannot quietly disappear again.
 */

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (k: string) => k, direction: "rtl", language: "ur" }),
}));

import { WorkspaceAppMenu } from "@/components/workspace/WorkspaceAppMenu";

const open = () => {
  render(<MemoryRouter><WorkspaceAppMenu /></MemoryRouter>);
  // Opened by keyboard: jsdom has no PointerEvent, and this also proves the
  // menu is reachable without a mouse (NFR-4).
  fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
};

describe("workspace app menu", () => {
  beforeEach(() => navigate.mockReset());

  it("offers a route to the dashboard", async () => {
    open();
    const item = await screen.findByText("ڈیش بورڈ");
    fireEvent.click(item);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/dashboard"));
  });

  it("offers a route to the profile", async () => {
    open();
    const item = await screen.findByText("میری پروفائل");
    fireEvent.click(item);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/profile"));
  });

  it("lists every standalone tool, so the workspace is not a dead end", async () => {
    open();
    // `t` is stubbed to echo the key, so each item renders its fallback label.
    for (const label of ["ٹرانسکرائب", "OCR", "بولیں", "استخراج", "ترجمہ"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });
});
