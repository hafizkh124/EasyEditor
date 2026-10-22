import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * SYSTEM-2026 §2 — Files: folders and documents in one tab, the jobs' results
 * (transcripts, OCR text, translations) in another. Translation projects are
 * results, not folders.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string, fallback?: string) => fallback ?? key, direction: "rtl" }),
}));
vi.mock("@/hooks/useSeo", () => ({ useSeo: () => {} }));
vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const general = { id: "p1", title: "فتاویٰ", kind: "general", updated_at: "2026-01-01T00:00:00Z" };
const translation = { id: "p2", title: "ترجمہ پروجیکٹ", kind: "translation", updated_at: "2026-03-01T00:00:00Z" };
const docA = { id: "d1", project_id: "p1", title: "زکوٰۃ", updated_at: "2026-02-01T00:00:00Z" };
const docB = { id: "d2", project_id: "p3", title: "نماز", updated_at: "2026-02-05T00:00:00Z" };
vi.mock("@/core/workspace/useAllDocuments", () => ({
  useAllDocuments: () => ({
    loading: false,
    refresh: vi.fn(),
    projects: [general, translation, { id: "p3", title: "عام", kind: "general", updated_at: "2026-01-01T00:00:00Z" }],
    docsMap: { p1: [docA], p2: [{ id: "d9", project_id: "p2", title: "ترجمہ", updated_at: "2026-03-01T00:00:00Z" }], p3: [docB] },
    allDocs: [
      { ...docA, projectName: "فتاویٰ", projectKind: "general" },
      { ...docB, projectName: "عام", projectKind: "general" },
    ],
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/bookTranslations", () => ({
  useBookTranslationList: (userId: string | null, enabled = true) => ({
    loading: false,
    items: userId && enabled ? [{ id: "bt1", title: "کتاب الصلاۃ", updatedAt: "2026-02-20T00:00:00Z" }] : [],
  }),
}));
vi.mock("@/hooks/useSessionHistory", () => ({
  useSessionHistory: (section: string) => ({
    loading: false,
    items:
      section === "transcribe"
        ? [{ id: "s1", title: "بیان", updated_at: "2026-02-10T00:00:00Z" }]
        : section === "research"
          ? [{ id: "c1", title: "زکوٰۃ پر گفتگو", updated_at: "2026-02-11T00:00:00Z", project_id: "p1" }]
          : [],
  }),
}));

import FilesPage from "@/pages/Files";

let landed: { pathname: string; state: unknown } | null = null;
function Probe() {
  const loc = useLocation();
  landed = { pathname: loc.pathname, state: loc.state };
  return null;
}

function renderFiles(path = "/files") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/files" element={<FilesPage />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Files page", () => {
  afterEach(() => {
    landed = null;
  });

  it("shows folders, but not translation projects, and every document newest first", () => {
    renderFiles();
    expect(screen.getByRole("button", { name: /فتاویٰ/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ترجمہ پروجیکٹ/ })).not.toBeInTheDocument();
    const links = within(screen.getByRole("list")).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/workspace/d2", "/workspace/d1"]);
  });

  it("opens a folder to just its documents, and a new document goes into it", () => {
    renderFiles();
    fireEvent.click(screen.getByRole("button", { name: /فتاویٰ/ }));
    const links = within(screen.getByRole("list", { name: "دستاویزات" })).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/workspace/d1"]);
    fireEvent.click(screen.getByRole("button", { name: "نیا دستاویز" }));
    expect(landed).toEqual({ pathname: "/workspace", state: { intent: "new-document", projectId: "p1" } });
  });

  it("lists the chats started in an open folder", () => {
    renderFiles("/files?folder=p1");
    const link = screen.getByRole("link", { name: /زکوٰۃ پر گفتگو/ });
    expect(link).toHaveAttribute("href", "/workspace?panel=research&session=c1");
    // …and only in that folder.
    renderFiles("/files?folder=p3");
    expect(screen.getAllByRole("link", { name: /زکوٰۃ پر گفتگو/ })).toHaveLength(1);
  });

  it("filters by the search box", () => {
    renderFiles();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "نماز" } });
    const links = within(screen.getByRole("list")).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/workspace/d2"]);
  });

  it("lists transcripts and translations under Results", () => {
    renderFiles("/files?tab=results");
    const links = within(screen.getByRole("list")).getAllByRole("link");
    // A book translation resumes in the translator by its own id; a workspace
    // translation project opens its document.
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/workspace/d9", "/translate-book/bt1", "/transcribe?session=s1"]);
  });
});
