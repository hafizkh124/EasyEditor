import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * SYSTEM-2026 §2 — the desktop/web sidebar: Home and Files only (the jobs are
 * behind "+", settings and admin in "Me"), then one recent list.
 */

vi.mock("@/hooks/useRecentItems", () => ({
  useRecentItems: () => ({
    loading: false,
    items: [
      { id: "doc:d1", kind: "document", title: "زکوٰۃ", updatedAt: "2026-02-01T00:00:00Z", to: "/workspace/d1" },
      { id: "chat:s1", kind: "chat", title: "سوال", updatedAt: "2026-01-01T00:00:00Z", to: "/workspace?panel=research&session=s1" },
    ],
  }),
}));

import { AppSidebar } from "@/components/layout/AppSidebar";
import { sectionNav } from "@/components/layout/appNav";

const t = ((key: string, fallback?: string) => fallback ?? key) as never;

function renderSidebar(collapsed = false) {
  return render(
    <MemoryRouter>
      <AppSidebar collapsed={collapsed} activePath="/files" navItems={sectionNav} t={t} showCollapseButton={false} />
    </MemoryRouter>,
  );
}

describe("AppSidebar", () => {
  it("has exactly Home and Files in its nav", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation");
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/dashboard", "/files"]);
    expect(within(nav).getByRole("link", { name: /فائلیں/ })).toHaveAttribute("aria-current", "page");
  });

  it("lists recent chats and documents", () => {
    renderSidebar();
    const recent = screen.getByRole("region", { name: "حالیہ" });
    const hrefs = within(recent).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/workspace/d1", "/workspace?panel=research&session=s1"]);
  });

  it("drops the recent list when collapsed", () => {
    renderSidebar(true);
    expect(screen.queryByRole("region", { name: "حالیہ" })).not.toBeInTheDocument();
  });
});
