import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ListChecks, Plus, Copy, Pencil, Archive, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BUILTIN_TASKS, setCustomTasks } from "@/lib/tasks/registry";
import { customTaskService, rowToDefinition, type CustomTaskRow } from "@/lib/tasks/customTasks";
import { stripHarakat } from "@/utils/arabicUtils";
import { TaskEditorDialog } from "./TaskEditorDialog";
import type { TaskDefinition } from "@/lib/tasks/types";
import { translateStored } from "@/lib/i18n";

/**
 * The AI Task Library (SPEC-M3 FR-2.4) — the catalogue of what the editor can
 * do, and where custom tasks are authored.
 *
 * Run history lives in the Trust tab; this tab is deliberately not a second copy
 * of `task_runs`.
 */
export const TasksTab: React.FC = () => {
  const [customRows, setCustomRows] = useState<CustomTaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [baseTask, setBaseTask] = useState<TaskDefinition | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string; systemPrompt: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await customTaskService.list();
      setCustomRows(rows);
      // Publish into the registry so the bubble and slash menus can resolve
      // custom slugs synchronously.
      setCustomTasks(rows.map(rowToDefinition));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = stripHarakat(query.trim().toLowerCase());
    const match = (label: string, slug: string) =>
      !q || stripHarakat(label.toLowerCase()).includes(q) || slug.toLowerCase().includes(q);

    return {
      builtins: BUILTIN_TASKS.filter((t) => match(t.defaultLabel, t.slug)),
      customs: customRows.filter((r) => match(r.label, r.slug)),
    };
  }, [query, customRows]);

  const handleDuplicate = (task: TaskDefinition) => {
    setEditing(null);
    setBaseTask(task);
    setEditorOpen(true);
  };

  const handleEdit = (row: CustomTaskRow) => {
    setBaseTask(row.base_task_slug ? BUILTIN_TASKS.find((t) => t.slug === row.base_task_slug) ?? null : null);
    setEditing({ id: row.id, label: row.label, systemPrompt: row.system_prompt });
    setEditorOpen(true);
  };

  const handleArchive = async (row: CustomTaskRow) => {
    const ok = await customTaskService.archive(row.id);
    if (ok) {
      toast.success(translateStored("toast.task.archived"));
      refresh();
    } else {
      toast.error(translateStored("toast.task.archive_failed"));
    }
  };

  return (
    <div className="flex flex-col h-full bg-background p-3" dir="rtl">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-primary">
          <ListChecks className="h-4 w-4" />
          <span>AI ٹاسک لائبریری</span>
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ٹاسک تلاش کریں…"
        className="h-7 text-xs mb-2"
        aria-label="ٹاسک تلاش کریں"
      />

      <ScrollArea className="flex-1 pe-2">
        <div className="space-y-3">
          {/* Custom tasks first — they are the user's own work. */}
          <section aria-labelledby="custom-tasks-heading">
            <h3
              id="custom-tasks-heading"
              className="text-xs font-semibold text-muted-foreground mb-1.5"
            >
              میرے ٹاسک ({filtered.customs.length})
            </h3>

            {filtered.customs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic pb-1">
                ابھی کوئی ذاتی ٹاسک نہیں۔ نیچے کسی بلٹ اِن ٹاسک کے سامنے
                <Copy className="h-3 w-3 inline mx-1" />
                دبا کر اپنی ہدایت کے ساتھ نقل بنائیں۔
              </p>
            ) : (
              <div className="space-y-1.5">
                {filtered.customs.map((row) => (
                  <div
                    key={row.id}
                    className="p-2 rounded-lg border border-primary/30 bg-primary/5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground truncate">{row.label}</span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => handleEdit(row)}
                          aria-label={`${row.label} میں ترمیم کریں`}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-destructive"
                          onClick={() => handleArchive(row)}
                          aria-label={`${row.label} ہٹائیں`}
                        >
                          <Archive className="h-3 w-3" />
                        </Button>
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{row.system_prompt}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="builtin-tasks-heading">
            <h3
              id="builtin-tasks-heading"
              className="text-xs font-semibold text-muted-foreground mb-1.5"
            >
              بلٹ اِن ٹاسک ({filtered.builtins.length})
            </h3>

            <div className="space-y-1.5">
              {filtered.builtins.map((task) => (
                <div
                  key={task.slug}
                  className="p-2 rounded-lg border border-border bg-card text-xs flex items-center justify-between gap-2"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-foreground block truncate">
                      {task.defaultLabel}
                    </span>
                    <span className="flex items-center gap-1 mt-0.5">
                      {task.chunkable && (
                        <Badge variant="outline" className="text-xs px-1 py-0 h-4">
                          طویل متن
                        </Badge>
                      )}
                      {task.producesSources && (
                        <Badge variant="outline" className="text-xs px-1 py-0 h-4">
                          حوالہ جات
                        </Badge>
                      )}
                      {task.engine === "client" && (
                        <Badge variant="outline" className="text-xs px-1 py-0 h-4">
                          مفت
                        </Badge>
                      )}
                    </span>
                  </span>

                  {/* Client-side tasks have no prompt to customise. */}
                  {task.engine === "refine-text" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 shrink-0"
                      onClick={() => handleDuplicate(task)}
                      aria-label={`${task.defaultLabel} کی نقل بنائیں`}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </ScrollArea>

      <Button
        size="sm"
        variant="outline"
        className="w-full h-7 text-xs gap-1 mt-2 shrink-0"
        onClick={() => handleDuplicate(BUILTIN_TASKS[0])}
      >
        <Plus className="h-3 w-3" />
        نیا ٹاسک بنائیں
      </Button>

      <TaskEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        baseTask={baseTask}
        existing={editing}
        onSaved={refresh}
      />
    </div>
  );
};
