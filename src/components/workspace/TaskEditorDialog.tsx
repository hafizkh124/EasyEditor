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
  const [label, setLabel] = useState(existing?.label ?? "");
  const [prompt, setPrompt] = useState(existing?.systemPrompt ?? "");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLabel(existing?.label ?? (baseTask ? `${baseTask.defaultLabel} (میرا)` : ""));
    setPrompt(existing?.systemPrompt ?? "");
  }, [open, existing, baseTask]);

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
        if (!ok) throw new Error("ٹاسک محفوظ نہ ہو سکا۔");
      } else if (baseTask) {
        await customTaskService.createFromBuiltin(baseTask.slug, label, prompt);
      }
      toast.success("ٹاسک محفوظ ہو گیا۔");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ٹاسک محفوظ نہ ہو سکا۔");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4 text-primary" />
            {existing ? "ٹاسک میں ترمیم" : "بلٹ اِن ٹاسک کی نقل بنائیں"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {baseTask
              ? `بنیاد: ${baseTask.defaultLabel} — اس کا طرزِ عمل وہی رہے گا، صرف ہدایت بدلے گی۔`
              : "اپنی ہدایت میں ترمیم کریں۔"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1 text-xs">
          <div className="space-y-1.5">
            <Label htmlFor="task-label" className="text-xs">ٹاسک کا نام</Label>
            <Input
              id="task-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="مثلاً: فقہی اسلوب میں ڈھالیں"
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-prompt" className="text-xs">ہدایت (System Prompt)</Label>
            <Textarea
              id="task-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              placeholder="ماڈل کو بتائیں کہ متن کے ساتھ کیا کرنا ہے۔ زبان برقرار رکھنے کی ہدایت لکھنا مفید ہے۔"
              className="text-xs leading-relaxed"
            />
            <p className="text-[11px] text-muted-foreground flex items-start gap-1">
              <Info className="h-3 w-3 shrink-0 mt-0.5 text-blue-500" />
              ہدایت سرور پر محفوظ رہتی ہے اور صرف آپ کے اکاؤنٹ سے پڑھی جاتی ہے۔ کم از کم 20 حروف۔
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            منسوخ
          </Button>
          <Button size="sm" disabled={!canSave} onClick={handleSave}>
            {saving ? "محفوظ ہو رہا ہے…" : "محفوظ کریں"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TaskEditorDialog;
