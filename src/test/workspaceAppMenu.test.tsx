import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  useLanguage: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    direction: "rtl",
    language: "ur",
  }),
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

  /**
   * UX-v1 P3 — the workspace has no sidebar and no bottom nav on a phone, so
   * this menu is the only way out, and Settings (BYOK key, voice engines,
   * language) used to be missing from it entirely.
   */
  it("offers a route to settings", async () => {
    open();
    const item = await screen.findByText("ترتیبات");
    fireEvent.click(item);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/settings"));
  });

  it("lists every standalone tool on the web, so the workspace is not a dead end", async () => {
    open();
    // `t` mirrors the additive API and returns the explicit fallback.
    for (const label of ["ٹرانسکرائب", "OCR", "بولیں", "ترجمہ"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  /**
   * The bug this menu shipped with. AppLayout's sidebar correctly dropped the
   * three cloud-only tools on desktop, but this menu kept its own hardcoded
   * copy of all five — and since WorkspaceLayout has no sidebar, this was the
   * ONLY menu a desktop user could reach. Every entry it offered them either
   * redirected straight back or failed.
   */
  describe("on the desktop", () => {
    beforeEach(() => {
      (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true };
      vi.stubEnv("VITE_LOCAL_VOICE", "true");
    });
    afterEach(() => {
      delete (window as unknown as { electronAPI?: unknown }).electronAPI;
      vi.unstubAllEnvs();
    });

    it("drops the cloud-only tools", async () => {
      open();
      await screen.findByText("ڈیش بورڈ");
      for (const label of ["OCR", "استخراج", "ترجمہ"]) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
    });

    it("keeps the tools that run on the offline voice engines", async () => {
      open();
      for (const label of ["ٹرانسکرائب", "بولیں"]) {
        expect(await screen.findByText(label)).toBeInTheDocument();
      }
    });

    it("still offers a way out to the dashboard, settings and the profile", async () => {
      open();
      expect(await screen.findByText("ڈیش بورڈ")).toBeInTheDocument();
      expect(await screen.findByText("ترتیبات")).toBeInTheDocument();
      expect(await screen.findByText("میری پروفائل")).toBeInTheDocument();
    });
  });
});
