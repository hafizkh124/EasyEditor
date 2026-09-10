// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/research/persistence", () => ({
  upsertResearchSession: vi.fn(async () => "sb-id"),
  loadLatestResearchSession: vi.fn(async () => ({ id: "sb-latest" })),
  loadResearchSession: vi.fn(async () => ({ id: "sb-one" })),
  deleteResearchSession: vi.fn(async () => undefined),
}));

import * as persistence from "@/lib/research/persistence";
import { getSessionStore } from "@/lib/sessions/store";

const anyWin = globalThis as unknown as { window?: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  delete anyWin.window;
});

const params = {
  id: null,
  title: "t",
  mode: "islamic" as const,
  messages: [],
  citations: [],
  selectedDomains: [],
};

describe("getSessionStore routing", () => {
  it("userId present → Supabase store", async () => {
    const store = getSessionStore("user-1");
    await store.upsert(params);
    expect(persistence.upsertResearchSession).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }));
    expect(await store.loadLatest("islamic")).toEqual({ id: "sb-latest" });
  });

  it("no userId + web (no electronAPI) → Noop store (never throws, saves nothing)", async () => {
    const store = getSessionStore(null);
    expect(await store.upsert(params)).toBeNull();
    expect(await store.loadLatest("islamic")).toBeNull();
    expect(await store.load("x")).toBeNull();
    await expect(store.remove("x")).resolves.toBeUndefined();
    expect(persistence.upsertResearchSession).not.toHaveBeenCalled();
  });

  it("no userId + desktop → Local store (IPC to workspace:invoke)", async () => {
    const invoke = vi.fn(async (_c: string, p: { method: string }) =>
      p.method === "upsertResearchSession" ? "local-id" : { id: "local-latest", messages: [], citations: [] },
    );
    anyWin.window = { electronAPI: { invoke } };
    const store = getSessionStore(null);
    expect(await store.upsert(params)).toBe("local-id");
    expect(invoke).toHaveBeenCalledWith("workspace:invoke", expect.objectContaining({ method: "upsertResearchSession" }));
    expect(await store.loadLatest("islamic")).toMatchObject({ id: "local-latest" });
    expect(persistence.upsertResearchSession).not.toHaveBeenCalled();
  });
});
