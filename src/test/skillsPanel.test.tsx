import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

/**
 * Settings → Skills (SYSTEM-2026 §7): one list of every skill, on web and
 * desktop. Playbooks appear only where the desktop agent can run them, and
 * switching one off goes to the desktop skills store the agent obeys; other
 * skills are hidden on this device.
 */
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key, direction: "rtl" }),
}));
vi.mock("@/lib/tasks/customTasks", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks/customTasks")>()),
  customTaskService: {
    list: vi.fn(async () => [
      {
        id: "row1", user_id: "u", slug: "my_style", label: "میرا اسلوب", system_prompt: "Rewrite in my house style please.",
        base_task_slug: "paraphrase", scope: "selection", apply_mode: "inline", output_format: "text",
        chunkable: true, produces_sources: false, archived_at: null, created_at: "", updated_at: "",
      },
    ]),
    archive: vi.fn(async () => true),
  },
}));

import { SkillsPanel } from "@/components/settings/SkillsPanel";
import { resetSkillsStore } from "@/lib/skills/useSkills";
import { PLAYBOOKS } from "~shared/playbooks/registry";

const list = vi.fn(async () => ({
  playbooks: PLAYBOOKS,
  global: {} as Record<string, boolean>,
  project: {} as Record<string, boolean>,
  merged: { [PLAYBOOKS[0].id]: false } as Record<string, boolean>,
}));
const setEnabled = vi.fn(async (id: string, on: boolean) => ({ global: { [id]: on } }));

function asWeb() {
  Object.defineProperty(window, "electronAPI", { configurable: true, value: undefined });
}
function asDesktop() {
  Object.defineProperty(window, "electronAPI", { configurable: true, value: { isDesktop: true, skills: { list, setEnabled } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetSkillsStore();
});

describe("SkillsPanel", () => {
  it("works on the web: guided, text skills, my skills and prompts, but no playbooks", async () => {
    asWeb();
    render(<SkillsPanel />);
    expect(await screen.findByText("میرا اسلوب")).toBeInTheDocument();
    expect(screen.getByText("مجھ سے پوچھو")).toBeInTheDocument();
    expect(screen.getByText("حرکات لگائیں (تشکیل)")).toBeInTheDocument();
    expect(screen.queryByText(PLAYBOOKS[0].title)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "نئی مہارت" })).toBeInTheDocument();
  });

  it("hides a non-playbook skill on this device", async () => {
    asWeb();
    render(<SkillsPanel />);
    const toggle = await screen.findByRole("switch", { name: "مجھ سے پوچھو" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(JSON.parse(localStorage.getItem("easyeditor.skills.hidden")!)).toContain("guided:grill_me");
  });

  it("on the desktop lists playbooks with /trigger, and reflects the store's switches", async () => {
    asDesktop();
    render(<SkillsPanel />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    const section = await screen.findByRole("region", { name: "کئی مراحل والی" });
    for (const pb of PLAYBOOKS) expect(within(section).getByText(pb.title)).toBeInTheDocument();
    const withTrigger = PLAYBOOKS.find((p) => p.trigger);
    if (withTrigger) expect(within(section).getByText(`/${withTrigger.trigger}`)).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByRole("switch", { name: PLAYBOOKS[0].title })).toHaveAttribute("aria-checked", "false"));
  });

  it("switching a playbook goes to the desktop skills store, scope global", async () => {
    asDesktop();
    render(<SkillsPanel />);
    const section = await screen.findByRole("region", { name: "کئی مراحل والی" });
    fireEvent.click(within(section).getByRole("switch", { name: PLAYBOOKS[1].title }));
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith(PLAYBOOKS[1].id, false, "global"));
  });
});
