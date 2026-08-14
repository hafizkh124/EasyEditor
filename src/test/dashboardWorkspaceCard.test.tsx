import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * UX-v1 P6 — the dashboard had no card or link to the Workspace at all
 * (registry.ts's `workspace` capability was missing `dashboard-grid`), while
 * its flagship "AI Research Assistant" card bounced through a redirect. This
 * pins the new card down so it cannot quietly disappear again.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string, fallback?: string) => fallback ?? key, direction: "rtl" }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/SubscriptionContext", () => ({ useSubscription: () => ({ subscription: null }) }));
vi.mock("@/hooks/useApproval", () => ({ useApproval: () => ({ isAdmin: false }) }));
vi.mock("@/lib/activityLog", () => ({ getRecentActivity: () => Promise.resolve([]) }));
vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useSeo", () => ({ useSeo: () => {} }));

import Dashboard from "@/pages/Dashboard";

describe("Dashboard workspace card", () => {
  it("links to the workspace, ahead of the standalone-tool grid", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    const link = await screen.findByText("Workspace");
    const anchor = link.closest("a");
    expect(anchor).toHaveAttribute("href", "/workspace");
  });
});
