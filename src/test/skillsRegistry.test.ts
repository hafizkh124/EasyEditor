import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSkills, skillsFor, matchesSkill } from "@/lib/skills/registry";
import { GRILL_ME } from "@/lib/skills/grillMe";
import { fillPromptTemplate } from "@/lib/skills/fillPrompt";
import { BUILTIN_TASKS, setCustomTasks } from "@/lib/tasks/registry";
import { rowToDefinition, type CustomTaskRow } from "@/lib/tasks/customTasks";
import { SCHOLARLY_PROMPTS } from "@/lib/prompts/promptsRegistry";
import { PLAYBOOKS } from "~shared/playbooks/registry";
import { getActionHandler } from "@/components/editor/bubbleMenuTasks";

/**
 * SYSTEM-2026 §7 — one skills list. Four separate lists (AI tasks, my prompts,
 * playbooks, scholarly prompts) became one, read by both `/` menus and
 * Settings → Skills.
 */

const row = (over: Partial<CustomTaskRow> = {}): CustomTaskRow => ({
  id: "r1", user_id: "u", slug: "my_style", label: "میرا اسلوب", system_prompt: "Rewrite in my house style.",
  base_task_slug: "paraphrase", scope: "selection", apply_mode: "inline", output_format: "text",
  chunkable: true, produces_sources: false, archived_at: null, created_at: "", updated_at: "", ...over,
});

const build = (over: Partial<Parameters<typeof buildSkills>[0]> = {}) =>
  buildSkills({ tasks: BUILTIN_TASKS, customRows: [row()], scholarlyPrompts: SCHOLARLY_PROMPTS, playbooks: PLAYBOOKS, ...over });

describe("skills registry", () => {
  afterEach(() => setCustomTasks([]));

  it("puts 'مجھ سے پوچھو' first, in the chat", () => {
    const [first] = build();
    expect(first).toMatchObject({ id: "guided:grill_me", kind: "guided", places: ["chat"] });
  });

  it("offers the built-in tasks in the editor, but not one that would overwrite the document", () => {
    const editor = skillsFor(build(), "editor", () => false).map((s) => s.taskSlug);
    expect(editor).toEqual(expect.arrayContaining(["add_harakat", "auto_format", "my_style"]));
    expect(editor).not.toContain("summarize_sections");
  });

  it("runs my skills in the editor and, as their instruction, in the chat", () => {
    const mine = build().find((s) => s.id === "mine:r1")!;
    expect(mine.places).toEqual(["editor", "chat"]);
    expect(mine.promptText).toBe("Rewrite in my house style.");
    const appending = build({ customRows: [row({ scope: "document", apply_mode: "append" })] }).find((s) => s.id === "mine:r1")!;
    expect(appending.places).toEqual(["chat"]);
    expect(build({ customRows: [row({ archived_at: "2026-01-01" })] }).some((s) => s.origin === "mine")).toBe(false);
  });

  it("leaves playbooks out where the agent cannot run them", () => {
    expect(build({ playbooks: null }).some((s) => s.kind === "workflow")).toBe(false);
    expect(build().filter((s) => s.kind === "workflow")).toHaveLength(PLAYBOOKS.length);
  });

  it("offers runnable recipes in the editor as multi-step skills", () => {
    const recipe = { id: "rc1", title: "Polish", steps: [{ taskSlug: "spelling_check", stepLabel: "املا" }], is_builtin: true, created_at: "" };
    const skill = build({ recipes: [recipe] }).find((s) => s.id === "recipe:rc1")!;
    expect(skill).toMatchObject({ kind: "workflow", places: ["editor"], recipe });
  });

  it("drops hidden skills from a menu", () => {
    const chat = skillsFor(build(), "chat", (id) => id === "guided:grill_me");
    expect(chat.some((s) => s.id === "guided:grill_me")).toBe(false);
    expect(chat.some((s) => s.kind === "prompt")).toBe(true);
  });

  it("matches on label and /trigger", () => {
    const pb = build().find((s) => s.trigger)!;
    expect(matchesSkill(pb, pb.trigger!)).toBe(true);
    expect(matchesSkill(pb, "zzz-no-match")).toBe(false);
  });

  it("fills the grill-me template with the topic", () => {
    const text = fillPromptTemplate(GRILL_ME, { topic: "  زکوٰۃ  " });
    expect(text).toContain("«زکوٰۃ»");
    expect(text).toContain("کافی ہے");
    expect(text).not.toContain("{{");
  });
});

describe("the editor's generic task runner", () => {
  afterEach(() => setCustomTasks([]));

  it("runs my skills from the selection bar, which used to skip them", () => {
    setCustomTasks([rowToDefinition(row())]);
    const runTask = vi.fn();
    const handler = getActionHandler({ runTask } as never, "my_style");
    expect(handler).toBeTypeOf("function");
    handler!();
    expect(runTask).toHaveBeenCalledWith("my_style");
  });

  it("offers nothing for a task that would overwrite the document", () => {
    expect(getActionHandler({ runTask: vi.fn() } as never, "summarize_sections")).toBeUndefined();
  });
});
