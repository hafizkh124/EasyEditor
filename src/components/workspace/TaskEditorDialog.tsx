import React, { useState } from "react";
import { toast } from "sonner";
import { Wand2, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { customTaskService } from "@/lib/tasks/customTasks";
import type { TaskDefinition } from "@/lib/tasks/types";
import { translateStored } from "@/lib/i18n";
import { useLanguage } from "@/contexts/LanguageContext";

interface TaskEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The built-in being duplicated, or the custom task being edited. */
  baseTask: TaskDefinition | null;
  existing?: { id: string; label: string; systemPrompt: string } | null;
  onSaved: () => void;
}

/**
 * Narrow authoring surface for custom tasks (SPEC-M3 FR-2.4).
 *
 * Deliberately not a free-form prompt editor: the user starts from a built-in
 * whose behaviour flags (chunkable, scope, apply mode) are already correct, and
 * edits only the name and the instruction. Those flags are what decide whether a
 * task may rewrite a heading in place or must run through the chunker, and they
 * are not safe to leave to free text.
 */
export const TaskEditorDialog: React.FC<TaskEditorDialogProps> = ({
  open,
  onOpenChange,
  baseTask,
  existing,
  onSaved,
}) => {
  const { t } = useLanguage();
  const [label, setLabel] = useState(existing?.label ?? "");
  const [prompt, setPrompt] = useState(existing?.systemPrompt ?? "");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLabel(existing?.label ?? (baseTask ? t("library.my_suffix", "{label} (mine)").replace("{label}", baseTask.defaultLabel) : ""));
    setPrompt(existing?.systemPrompt ?? "");
  }, [open, existing, baseTask, t]);

  const canSave = label.trim().length >= 2 && prompt.trim().length >= 20 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (existing) {
        const ok = await customTaskService.update(existing.id, {
          label: label.trim(),
          system_prompt: prompt.trim(),
        });
        if (!ok) throw new Error(translateStored("toast.task.save_failed"));
      } else if (baseTask) {
        await customTaskService.createFromBuiltin(baseTask.slug, label, prompt);
      }
      toast.success(translateStored("toast.task.saved"));
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : translateStored("toast.task.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4 text-primary" />
            {existing ? t("library.edit_task_title", "Edit task") : t("library.duplicate_task_title", "Duplicate built-in task")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {baseTask
              ? t("library.task_base_desc", "Base: {label} — its behaviour flags stay the same, only the instruction changes.").replace("{label}", baseTask.defaultLabel)
              : t("library.task_edit_prompt_desc", "Edit your instruction.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1 text-xs">
          <div className="space-y-1.5">
            <Label htmlFor="task-label" className="text-xs">{t("library.task_name_label", "Task name:")}</Label>
            <Input
              id="task-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("library.task_name_placeholder", "e.g. In a fiqh style")}
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-prompt" className="text-xs">{t("library.task_prompt_label", "Instruction (System Prompt)")}</Label>
            <Textarea
              id="task-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              placeholder={t("library.task_prompt_placeholder", "Tell the model what to do with the text. A keep-the-language instruction is useful.")}
              className="text-xs leading-relaxed"
            />
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" />
              {t("library.task_prompt_hint", "The instruction is stored on the server and only read from your account. At least 20 characters.")}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button size="sm" disabled={!canSave} onClick={handleSave}>
            {saving ? t("library.saving_task", "Saving…") : t("common.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TaskEditorDialog;
