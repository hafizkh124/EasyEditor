import { describe, it, expect, beforeEach } from "vitest";
import { rowToDefinition, type CustomTaskRow } from "@/lib/tasks/customTasks";
import {
  BUILTIN_TASKS,
  getTaskBySlug,
  getTasksForSurface,
  listAllTasks,
  setCustomTasks,
} from "@/lib/tasks/registry";

/**
 * SPEC-M3 FR-2.4 / FR-2.5 — custom tasks as registry entries.
 *
 * The security-critical property is that a custom task carries only an `id`.
 * If a prompt ever appeared on a `TaskDefinition`, it would travel in the
 * request body and `refine-text` — which runs on the service-role key — would
 * become an open LLM proxy (R10).
 */

function row(partial: Partial<CustomTaskRow> = {}): CustomTaskRow {
  return {
    id: "task-uuid-1",
    user_id: "user-1",
    slug: "fiqhi-style",
    label: "فقہی اسلوب",
    system_prompt: "Rewrite the passage in classical fiqhi register.",
    base_task_slug: "formalize",
    scope: "either",
    apply_mode: "inline",
    output_format: "text",
    chunkable: true,
    produces_sources: false,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...partial,
  };
}

describe("rowToDefinition (FR-2.5)", () => {
  it("carries the task id and never the prompt text", () => {
    const def = rowToDefinition(row());

    expect(def.taskId).toBe("task-uuid-1");
    expect(def.isCustom).toBe(true);
    // The prompt must not be reachable from anything the client sends.
    expect(JSON.stringify(def)).not.toContain("classical fiqhi register");
  });

  it("inherits the behaviour flags stored with the row", () => {
    const def = rowToDefinition(row({ chunkable: false, produces_sources: true }));
    expect(def.chunkable).toBe(false);
    expect(def.producesSources).toBe(true);
  });
});

describe("registry merge (FR-2.4)", () => {
  beforeEach(() => setCustomTasks([]));

  it("resolves custom slugs alongside built-ins", () => {
    expect(getTaskBySlug("fiqhi-style")).toBeUndefined();

    setCustomTasks([rowToDefinition(row())]);

    expect(getTaskBySlug("fiqhi-style")?.taskId).toBe("task-uuid-1");
    // Built-ins must still resolve — a custom set must never replace them.
    expect(getTaskBySlug("add_harakat")).toBeDefined();
    expect(listAllTasks().length).toBe(BUILTIN_TASKS.length + 1);
  });

  it("surfaces custom tasks in the bubble and slash menus", () => {
    setCustomTasks([rowToDefinition(row())]);

    expect(getTasksForSurface("bubble").some((t) => t.slug === "fiqhi-style")).toBe(true);
    expect(getTasksForSurface("slash").some((t) => t.slug === "fiqhi-style")).toBe(true);
  });

  it("still keeps auto_format out of the bubble surface", () => {
    setCustomTasks([rowToDefinition(row())]);
    // FR-2.3 must survive the merge: auto_format rewrites the whole document,
    // so offering it from a selection bar would mislead.
    expect(getTasksForSurface("bubble").some((t) => t.slug === "auto_format")).toBe(false);
  });

  it("replaces the previous custom set rather than accumulating", () => {
    setCustomTasks([rowToDefinition(row())]);
    setCustomTasks([rowToDefinition(row({ slug: "other", id: "task-uuid-2" }))]);

    expect(getTaskBySlug("fiqhi-style")).toBeUndefined();
    expect(getTaskBySlug("other")).toBeDefined();
  });
});
