// @vitest-environment node
// electron/ipc/skillsHandlers.ts — SKILLS_INVOKE's action switch (M11 Phase 3
// / M12 Phase H, ADR-0047). Mirrors connectorsHandlers.test.ts's shape:
// `list` returns the real playbook registry + a merged enable map;
// `setEnabled` routes to the global or the per-project store by scope.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createElectronMock } from "./helpers/electronMock";
import { PLAYBOOKS } from "../../shared/playbooks/registry";

const electron = createElectronMock();
vi.mock("electron", () => electron);

const globalStore = {
  readGlobalSkills: vi.fn(() => ({} as Record<string, boolean>)),
  setGlobalSkill: vi.fn((id: string, on: boolean) => ({ [id]: on } as Record<string, boolean>)),
};
vi.mock("../../electron/skills/globalStore.ts", () => globalStore);

const projectFolder = {
  readSkills: vi.fn(() => ({} as Record<string, boolean>)),
  setSkill: vi.fn((_root: string, id: string, on: boolean) => ({ [id]: on } as Record<string, boolean>)),
};
vi.mock("../../electron/fs/projectFolder.ts", () => projectFolder);

let invoke: (payload: Record<string, unknown>) => Promise<unknown>;

beforeAll(async () => {
  const mod = await import("../../electron/ipc/skillsHandlers.ts");
  mod.registerSkillsHandlers();
  invoke = (payload) => electron.invoke("skills:invoke", payload) as Promise<unknown>;
});

beforeEach(() => {
  vi.clearAllMocks();
  globalStore.readGlobalSkills.mockReturnValue({});
});

describe("skillsHandlers", () => {
  it("list returns the real playbook registry plus a merged map with an entry per skill, every skill on by default", async () => {
    const r = (await invoke({ action: "list" })) as {
      playbooks: unknown[]; merged: Record<string, boolean>;
    };
    expect(r.playbooks).toHaveLength(PLAYBOOKS.length);
    expect(Object.keys(r.merged).sort()).toEqual(PLAYBOOKS.map((p) => p.id).sort());
    for (const v of Object.values(r.merged)) expect(v).toBe(true);
  });

  it("list reflects a global switch turned off", async () => {
    globalStore.readGlobalSkills.mockReturnValue({ "zakat-assessment-workflow": false });
    const r = (await invoke({ action: "list" })) as { merged: Record<string, boolean> };
    expect(r.merged["zakat-assessment-workflow"]).toBe(false);
  });

  it("setEnabled scope:global writes the global store", async () => {
    await invoke({ action: "setEnabled", id: "thesis-university-format", on: false, scope: "global" });
    expect(globalStore.setGlobalSkill).toHaveBeenCalledWith("thesis-university-format", false);
    expect(projectFolder.setSkill).not.toHaveBeenCalled();
  });

  it("setEnabled scope:project writes the project manifest", async () => {
    await invoke({ action: "setEnabled", id: "shariah-fatwa", on: false, scope: "project", projectRoot: "/p" });
    expect(projectFolder.setSkill).toHaveBeenCalledWith("/p", "shariah-fatwa", false);
  });

  it("setEnabled scope:project without a projectRoot throws", async () => {
    await expect(invoke({ action: "setEnabled", id: "shariah-fatwa", on: false, scope: "project" })).rejects.toThrow(/projectRoot/);
  });

  it("an unknown action throws", async () => {
    await expect(invoke({ action: "wat" })).rejects.toThrow();
  });
});
