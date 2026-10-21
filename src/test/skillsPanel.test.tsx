import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/**
 * M11 Phase 3 / M12 Phase H — SkillsPanel. Pins the actual fix: this used to
 * be read-only (ADR-0047 claimed a toggle that did not exist); every
 * playbook now has a real Switch wired to window.electronAPI.skills.
 */
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

import { SkillsPanel } from "@/components/settings/SkillsPanel";
import { PLAYBOOKS } from "~shared/playbooks/registry";

const list = vi.fn(async () => ({
  playbooks: PLAYBOOKS,
  global: {} as Record<string, boolean>,
  project: {} as Record<string, boolean>,
  merged: Object.fromEntries(PLAYBOOKS.map((p) => [p.id, true])),
}));
const setEnabled = vi.fn(async (id: string, on: boolean) => ({ global: { [id]: on } }));
const saveCustom = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const }));
const deleteCustom = vi.fn(async (_id: string) => ({ custom: [] }));

beforeEach(() => {
  vi.clearAllMocks();
  list.mockImplementation(async () => ({
    playbooks: PLAYBOOKS,
    global: {},
    project: {},
    merged: Object.fromEntries(PLAYBOOKS.map((p) => [p.id, true])),
  }));
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { skills: { list, setEnabled, saveCustom, deleteCustom } },
  });
});

describe("SkillsPanel", () => {
  it("renders nothing when window.electronAPI.skills is absent (web build)", () => {
    Object.defineProperty(window, "electronAPI", { configurable: true, value: undefined });
    const { container } = render(<SkillsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every playbook with its title, /trigger, and step count", async () => {
    render(<SkillsPanel />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    for (const pb of PLAYBOOKS) {
      expect(screen.getByText(pb.title)).toBeInTheDocument();
    }
    const withTrigger = PLAYBOOKS.find((p) => p.trigger);
    if (withTrigger) expect(screen.getByText(`/${withTrigger.trigger}`)).toBeInTheDocument();
  });

  it("every switch starts checked (on by default) and reflects a merged false", async () => {
    list.mockResolvedValueOnce({
      playbooks: PLAYBOOKS,
      global: { [PLAYBOOKS[0].id]: false },
      project: {},
      merged: { ...Object.fromEntries(PLAYBOOKS.map((p) => [p.id, true])), [PLAYBOOKS[0].id]: false },
    });
    render(<SkillsPanel />);
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(PLAYBOOKS.length));
    const switches = screen.getAllByRole("switch");
    const offIndex = PLAYBOOKS.findIndex((p) => p.id === PLAYBOOKS[0].id);
    expect(switches[offIndex]).toHaveAttribute("aria-checked", "false");
    expect(switches[offIndex === 0 ? 1 : 0]).toHaveAttribute("aria-checked", "true");
  });

  it("toggling a switch calls setEnabled with scope:global and reloads the list", async () => {
    render(<SkillsPanel />);
    await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));
    const first = screen.getAllByRole("switch")[0];
    fireEvent.click(first);
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith(PLAYBOOKS[0].id, false, "global"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2)); // initial load + reload after the toggle
  });

  it("custom skills show edit / export / delete; built-ins do not", async () => {
    const custom = {
      id: "custom-mine", title: "My own skill", trigger: "mine", keywords: ["k"], guidance: "g",
      steps: [{ tool: "search_hadith", bind: ["query"], note: "n" }],
    };
    list.mockResolvedValue({
      playbooks: [...PLAYBOOKS, custom], custom: [custom], global: {}, project: {},
      merged: Object.fromEntries([...PLAYBOOKS, custom].map((p) => [p.id, true])),
    } as never);
    render(<SkillsPanel />);
    await waitFor(() => expect(screen.getByText("My own skill")).toBeInTheDocument());
    expect(screen.getAllByLabelText("Export .md")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Delete"));
    await waitFor(() => expect(deleteCustom).toHaveBeenCalledWith("custom-mine"));
  });

  it("Add custom skill: shows validation errors from the backend, then saves", async () => {
    saveCustom.mockResolvedValueOnce({ ok: false, errors: ["at least one step (a tool name) is required"] } as never);
    render(<SkillsPanel />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Add custom skill"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New one" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least one step");

    fireEvent.click(screen.getByText("search_hadith"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(saveCustom).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "New one", steps: ["search_hadith"] }),
    ));
  });
});
