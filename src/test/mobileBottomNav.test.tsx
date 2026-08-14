import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * UX-v1 P3 — AppLayout's mobile bottom nav used to map `sectionNav`, the
 * SIDEBAR's list. Sidebar entries can be a group with `children` (Tools:
 * Transcribe/Speak/OCR/Extract/Translate), which a flat icon row cannot
 * expand — so the nav rendered the group's own `path`, which was hardcoded to
 * `children[0].path`. Tapping a button labelled "Tools" silently landed on
 * Speech-to-Text. It now reads the `mobile-nav` capability surface instead,
 * whose entries are always individually routable. This pins that down.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string, fallback?: string) => fallback ?? key, direction: "rtl" }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useApproval", () => ({ useApproval: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useSidebarCollapsed", () => ({ useSidebarCollapsed: () => [false, vi.fn(), vi.fn()] }));
vi.mock("@/components/SubscriptionBanner", () => ({ default: () => null }));
vi.mock("@/components/AppVersionBadge", () => ({ default: () => null }));
vi.mock("@/components/ModeBadge", () => ({ default: () => null }));
vi.mock("@/components/auth/DesktopAccountMenu", () => ({ DesktopAccountMenu: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/layout/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/layout/AppSidebar", async () => {
  const actual = await vi.importActual<typeof import("@/components/layout/appNav")>("@/components/layout/appNav");
  return { AppSidebar: () => null, ...actual };
});

import AppLayout from "@/components/AppLayout";

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AppLayout>
        <div>content</div>
      </AppLayout>
    </MemoryRouter>,
  );
}

describe("AppLayout mobile bottom nav", () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.unstubAllEnvs();
  });

  it("has no entry labelled Tools, and none of its links point at /transcribe by way of a group shortcut", () => {
    renderLayout();
    // "Tools" was never a capability — it was a synthetic sidebar-only group.
    expect(screen.queryByText("nav.tools")).not.toBeInTheDocument();
    expect(screen.queryByText("Tools")).not.toBeInTheDocument();
  });

  it("links every item straight to its own real route", () => {
    renderLayout();
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    // Every mobile-nav capability is individually routable — Workspace,
    // Dashboard, Transcribe (web: always) and Settings.
    expect(links).toEqual(expect.arrayContaining(["/workspace", "/dashboard", "/transcribe", "/settings"]));
    // In particular, no link that should say "Dashboard" or "Settings" was
    // ever silently pointed at /transcribe.
    expect(links.filter((href) => href === "/transcribe")).toHaveLength(1);
  });

  describe("on desktop with local voice off", () => {
    it("drops transcribe rather than leaving a link that fails", () => {
      (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true };
      vi.stubEnv("VITE_LOCAL_VOICE", "false");
      renderLayout();
      const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
      expect(links).not.toContain("/transcribe");
      expect(links).toEqual(expect.arrayContaining(["/workspace", "/settings"]));
    });
  });
});
