import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * SYSTEM-2026 §3 — Home: one question box, the three core jobs (the same list
 * as the "+" menu), and a single recent list that mixes chats and documents,
 * newest first.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string, fallback?: string) => fallback ?? key, direction: "rtl" }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/SubscriptionContext", () => ({ useSubscription: () => ({ subscription: null }) }));
vi.mock("@/hooks/useApproval", () => ({ useApproval: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useSeo", () => ({ useSeo: () => {} }));
vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useSessionHistory", () => ({
  useSessionHistory: () => ({
    loading: false,
    items: [{ id: "s1", title: "Older chat", updated_at: "2026-01-01T00:00:00Z" }],
  }),
}));
vi.mock("@/core/workspace/useAllDocuments", () => ({
  useAllDocuments: () => ({
    loading: false,
    allDocs: [{ id: "d1", title: "Newer document", updated_at: "2026-02-01T00:00:00Z" }],
  }),
}));

import Dashboard from "@/pages/Dashboard";

let landed: { pathname: string; search: string; state: unknown } | null = null;
function Probe() {
  const loc = useLocation();
  landed = { pathname: loc.pathname, search: loc.search, state: loc.state };
  return null;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Home", () => {
  afterEach(() => {
    landed = null;
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.unstubAllEnvs();
  });

  it("sends the question to the research chat, pre-filled rather than auto-sent", () => {
    renderHome();
    const box = screen.getByRole("textbox", { name: /سوال پوچھیں/ });
    fireEvent.change(box, { target: { value: "  نماز کی شرائط؟ " } });
    fireEvent.click(screen.getByRole("button", { name: "پوچھیں" }));
    expect(landed).toEqual({ pathname: "/workspace", search: "?panel=research", state: { question: "نماز کی شرائط؟" } });
  });

  it("does not submit an empty question", () => {
    renderHome();
    expect(screen.getByRole("button", { name: "پوچھیں" })).toBeDisabled();
  });

  it("offers the three core jobs", () => {
    renderHome();
    for (const label of ["آڈیو سے متن", "تصویر/PDF سے متن", "کتاب کا ترجمہ"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("drops jobs that cannot run on this runtime", () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true };
    vi.stubEnv("VITE_LOCAL_VOICE", "false");
    renderHome();
    expect(screen.queryByRole("button", { name: /آڈیو سے متن/ })).not.toBeInTheDocument();
  });

  it("lists chats and documents together, newest first", () => {
    renderHome();
    const list = screen.getByRole("list");
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      expect.stringContaining("Newer document"),
      expect.stringContaining("Older chat"),
    ]);
    expect(links[0]).toHaveAttribute("href", "/workspace/d1");
    expect(links[1]).toHaveAttribute("href", "/workspace?panel=research&session=s1");
  });
});
