import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const listProjects = vi.fn();
const listDocuments = vi.fn();

vi.mock("@/core/workspace/documentService", () => ({
  documentService: {
    listProjects: (...a: unknown[]) => listProjects(...a),
    listDocuments: (...a: unknown[]) => listDocuments(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { useAllDocuments, resetAllDocumentsCache } from "@/core/workspace/useAllDocuments";

describe("useAllDocuments — shared load", () => {
  beforeEach(() => {
    resetAllDocumentsCache();
    listProjects.mockReset().mockResolvedValue([
      { id: "p1", title: "One", kind: "general" },
      { id: "p2", title: "Two", kind: "general" },
    ]);
    listDocuments.mockReset().mockImplementation(async (id: string) => [{ id: `d-${id}`, project_id: id }]);
  });

  it("many simultaneous mounts trigger a single tree load", async () => {
    const hooks = Array.from({ length: 8 }, () => renderHook(() => useAllDocuments()));
    await waitFor(() => expect(hooks.every((h) => h.result.current.allDocs.length === 2)).toBe(true));

    expect(listProjects).toHaveBeenCalledTimes(1);
    expect(listDocuments).toHaveBeenCalledTimes(2);
  });

  it("a later mount reuses the fresh result, but refresh() always refetches", async () => {
    const first = renderHook(() => useAllDocuments());
    await waitFor(() => expect(first.result.current.allDocs).toHaveLength(2));

    const second = renderHook(() => useAllDocuments());
    await waitFor(() => expect(second.result.current.allDocs).toHaveLength(2));
    expect(listProjects).toHaveBeenCalledTimes(1);

    await first.result.current.refresh();
    expect(listProjects).toHaveBeenCalledTimes(2);
  });
});
