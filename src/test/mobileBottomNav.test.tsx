import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * SYSTEM-2026 §2 (mobile nav option 1): the bottom bar is exactly two tabs —
 * Chat/Write and Files — with the "+" create button in the middle, and "Me"
 * moved to the top-bar avatar. The three core jobs (audio to text, image/PDF
 * to text, book translation) are reached through "+", which reads the
 * `create-menu` capability surface.
 *
 * Kept from UX-v1 P3: no entry may be a synthetic "Tools" group that silently
 * lands on one tool, and a tool that cannot run on this runtime is absent
 * rather than a link that fails.
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
vi.mock("@/components/layout/AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("@/components/layout/AppSidebar", async () => {
  const actual = await vi.importActual<typeof import("@/components/layout/appNav")>("@/components/layout/appNav");
  return { AppSidebar: () => null, ...actual };
});

import AppLayout from "@/components/AppLayout";

function renderLayout(path = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>
        <div>content</div>
      </AppLayout>
    </MemoryRouter>,
  );
}

function tabBar() {
  return screen.getByRole("navigation", { name: "مینو" });
}

function openCreateSheet() {
  fireEvent.click(within(tabBar()).getByRole("button", { name: "نیا کام شروع کریں" }));
  return screen.getByRole("dialog");
}

describe("AppLayout mobile tab bar", () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.unstubAllEnvs();
  });

  it("has exactly two tabs, Chat/Write and Files, with the create button between them", () => {
    renderLayout();
    const bar = tabBar();
    const links = within(bar).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/dashboard", "/files"]);
    expect(within(bar).getByText("چیٹ/لکھیں")).toBeInTheDocument();
    expect(within(bar).getByText("فائلیں")).toBeInTheDocument();
    // The "+" sits in the middle of the grid: link, button, link.
    const order = Array.from(bar.querySelectorAll("a, button")).map((el) => el.tagName);
    expect(order).toEqual(["A", "BUTTON", "A"]);
  });

  it("has no synthetic Tools entry and no tool route in the bar itself", () => {
    renderLayout();
    const bar = tabBar();
    expect(within(bar).queryByText("Tools")).not.toBeInTheDocument();
    expect(within(bar).queryByText("nav.tools")).not.toBeInTheDocument();
    const hrefs = within(bar).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/transcribe");
  });

  it("marks the current tab", () => {
    renderLayout("/files");
    const files = within(tabBar()).getByRole("link", { name: /فائلیں/ });
    expect(files).toHaveAttribute("aria-current", "page");
  });

  it("offers the three core jobs first, then a new chat and a new document, in the + sheet", () => {
    renderLayout();
    const sheet = openCreateSheet();
    const labels = within(sheet).getAllByRole("button").map((b) => b.textContent?.trim()).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining(["آڈیو سے متن", "تصویر/PDF سے متن", "کتاب کا ترجمہ", "نئی چیٹ", "نیا دستاویز"]));
    expect(labels.indexOf("آڈیو سے متن")).toBeLessThan(labels.indexOf("نئی چیٹ"));
  });

  describe("on desktop with local voice off", () => {
    it("drops the jobs that cannot run here rather than leaving buttons that fail", () => {
      (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true };
      vi.stubEnv("VITE_LOCAL_VOICE", "false");
      renderLayout();
      const sheet = openCreateSheet();
      expect(within(sheet).queryByText("آڈیو سے متن")).not.toBeInTheDocument();
      // Pages run on the user's own key or account (SYSTEM-2026 §10), so they stay.
      expect(within(sheet).getByText("تصویر/PDF سے متن")).toBeInTheDocument();
      expect(within(sheet).getByText("کتاب کا ترجمہ")).toBeInTheDocument();
      expect(within(sheet).getByText("نئی چیٹ")).toBeInTheDocument();
      expect(within(sheet).getByText("نیا دستاویز")).toBeInTheDocument();
    });
  });
});
