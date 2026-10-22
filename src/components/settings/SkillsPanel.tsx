import { useRef, useState } from "react";
import { Archive, Copy, Download, Pencil, Plus, ScrollText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { TaskEditorDialog } from "@/components/workspace/TaskEditorDialog";
import { BUILTIN_TASKS, getTaskBySlug } from "@/lib/tasks/registry";
import { customTaskService } from "@/lib/tasks/customTasks";
import type { TaskDefinition } from "@/lib/tasks/types";
import { useSkills, refreshSkills } from "@/lib/skills/useSkills";
import type { Skill } from "@/lib/skills/types";
import type { TranslationKey } from "@/lib/i18n";
import type { Playbook } from "~shared/playbooks/registry";
import { serializeSkillMarkdown } from "~shared/playbooks/parseSkillMarkdown";
import { AGENT_TOOLS } from "~shared/agent/toolSchemas";

/**
 * Settings → Skills (SYSTEM-2026 §7): every skill in one list, on web and
 * desktop alike. Each can be shown or hidden in the `/` menus; my skills can be
 * created (from a built-in), edited and archived here. "Manage skills" at the
 * end of every `/` menu opens this page.
 *
 * Hiding a playbook switches it off in the desktop skills store — the same
 * switch the agent obeys for keyword matching and an explicit `/trigger`.
 *
 * On the desktop the scholar can also add a multi-step skill of their own, or
 * import one as `skill.md`, and edit, export or delete it; it is listed under
 * "My skills". One with the same /trigger as a built-in runs once that
 * built-in is switched off.
 */

interface PlaybookDraft {
  id?: string;
  title: string;
  trigger: string;
  keywords: string;
  guidance: string;
  steps: string[];
}

const EMPTY_DRAFT: PlaybookDraft = { title: "", trigger: "", keywords: "", guidance: "", steps: [] };

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const GROUPS: { key: string; titleKey: TranslationKey; fallback: string; match: (s: Skill) => boolean }[] = [
  { key: "guided", titleKey: "skills.group_guided", fallback: "سوال جواب", match: (s) => s.kind === "guided" },
  { key: "mine", titleKey: "skills.group_mine", fallback: "میری مہارتیں", match: (s) => s.origin === "mine" },
  { key: "edit", titleKey: "skills.group_edit", fallback: "متن کی مہارتیں", match: (s) => s.kind === "edit" && s.origin === "builtin" },
  { key: "prompt", titleKey: "skills.group_prompt", fallback: "علمی پرامپٹس", match: (s) => s.kind === "prompt" },
  { key: "workflow", titleKey: "skills.group_workflow", fallback: "کئی مراحل والی", match: (s) => s.kind === "workflow" && s.origin === "builtin" },
];

export function SkillsPanel() {
  const { t } = useLanguage();
  const { skills, isHidden, setHidden, playbooks } = useSkills();
  const [editor, setEditor] = useState<{ base: TaskDefinition | null; existing: { id: string; label: string; systemPrompt: string } | null } | null>(null);
  // The desktop's own multi-step skills (custom playbooks).
  const skillsApi = typeof window !== "undefined" ? window.electronAPI?.skills : undefined;
  const canCustomPlaybooks = Boolean(skillsApi?.saveCustom);
  const [draft, setDraft] = useState<PlaybookDraft | null>(null);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const playbookOf = (skill: Skill): Playbook | undefined => playbooks.find((p) => p.id === skill.playbookId);

  const saveDraft = async () => {
    if (!skillsApi?.saveCustom || !draft) return;
    const r = await skillsApi.saveCustom({
      id: draft.id,
      title: draft.title,
      trigger: draft.trigger,
      keywords: draft.keywords.split(/[,،]/).map((k) => k.trim()).filter(Boolean),
      guidance: draft.guidance,
      steps: draft.steps,
    });
    if (!r.ok) {
      setDraftErrors(r.errors);
      return;
    }
    setDraft(null);
    setDraftErrors([]);
    await refreshSkills();
  };

  const importSkillFile = async (file: File | undefined) => {
    if (!skillsApi?.saveCustom || !file) return;
    const r = await skillsApi.saveCustom({ markdown: await file.text() });
    if (!r.ok) {
      setDraftErrors(r.errors);
      setDraft({ ...EMPTY_DRAFT });
      return;
    }
    await refreshSkills();
  };

  const deletePlaybook = async (id: string) => {
    if (!skillsApi?.deleteCustom) return;
    await skillsApi.deleteCustom(id);
    await refreshSkills();
  };

  const toggleStep = (tool: string) =>
    setDraft((d) => d && ({ ...d, steps: d.steps.includes(tool) ? d.steps.filter((x) => x !== tool) : [...d.steps, tool] }));

  const placeLabel = (place: string) =>
    place === "editor" ? t("skills.place_editor", "ایڈیٹر") : t("skills.place_chat", "چیٹ");

  const archive = async (skill: Skill) => {
    if (!skill.rowId) return;
    const ok = await customTaskService.archive(skill.rowId).catch(() => false);
    if (!ok) toast.error(t("skills.archive_failed"));
    await refreshSkills();
  };

  const stepCount = (skill: Skill) => playbookOf(skill)?.steps.length;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ScrollText className="h-5 w-5 text-primary" aria-hidden="true" />
            {t("skills.hub.title", "مہارتیں")}
          </CardTitle>
          <CardDescription>
            {t("skills.hub.subtitle_all", "ایڈیٹر اور چیٹ میں / لکھنے سے یہ مہارتیں کھلتی ہیں۔ جو نہ چاہیے اسے بند کر دیں۔")}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="gap-2" onClick={() => setEditor({ base: BUILTIN_TASKS[0], existing: null })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("skills.new", "نئی مہارت")}
          </Button>
          {canCustomPlaybooks && (
            <>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => { setDraftErrors([]); setDraft({ ...EMPTY_DRAFT }); }}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("skills.custom.add", "Add custom skill")}
              </Button>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                {t("skills.custom.import", "Import skill.md")}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".md,text/markdown,text/plain"
                className="hidden"
                data-testid="skill-import-input"
                onChange={(e) => { void importSkillFile(e.target.files?.[0]); e.target.value = ""; }}
              />
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {GROUPS.map((group) => {
          const rows = skills.filter(group.match);
          if (rows.length === 0) return null;
          return (
            <section key={group.key} aria-labelledby={`skills-${group.key}`} className="space-y-1">
              <h3 id={`skills-${group.key}`} className="px-3 text-xs font-semibold text-muted-foreground">
                {t(group.titleKey, group.fallback)}
              </h3>
              {rows.map((skill) => {
                const shown = !isHidden(skill.id);
                const steps = stepCount(skill);
                const base = skill.taskSlug ? getTaskBySlug(skill.taskSlug) : undefined;
                return (
                  <div key={skill.id} className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-muted">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{skill.label}</span>
                        {skill.trigger && (
                          <code className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">/{skill.trigger}</code>
                        )}
                        {skill.places.map((place) => (
                          <Badge key={place} variant="secondary" className="px-1.5 py-0 text-xs font-normal">{placeLabel(place)}</Badge>
                        ))}
                      </div>
                      {skill.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
                      )}
                      {steps !== undefined && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("skills.step_count", "{count} steps").replace("{count}", String(steps))}
                        </p>
                      )}
                    </div>
                    {skill.origin === "builtin" && skill.kind === "edit" && base && !base.isCustom && base.engine === "refine-text" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label={t("skills.copy", "اس سے اپنی مہارت بنائیں")}
                        title={t("skills.copy", "اس سے اپنی مہارت بنائیں")}
                        onClick={() => setEditor({ base, existing: null })}
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                    {skill.origin === "mine" && skill.kind === "workflow" && playbookOf(skill) && canCustomPlaybooks && (() => {
                      const pb = playbookOf(skill)!;
                      return (
                        <>
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                            aria-label={t("skills.custom.edit", "Edit")}
                            onClick={() => {
                              setDraftErrors([]);
                              setDraft({
                                id: pb.id, title: pb.title, trigger: pb.trigger ?? "",
                                keywords: pb.keywords.join(", "), guidance: pb.guidance ?? "",
                                steps: pb.steps.map((st) => st.tool),
                              });
                            }}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                            aria-label={t("skills.custom.export", "Export .md")}
                            title={t("skills.custom.export", "Export .md")}
                            onClick={() => downloadText(`${pb.trigger || pb.id}.md`, serializeSkillMarkdown(pb))}
                          >
                            <Download className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                            aria-label={t("skills.custom.delete", "Delete")}
                            onClick={() => void deletePlaybook(pb.id)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </>
                      );
                    })()}
                    {skill.origin === "mine" && skill.rowId && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label={t("skills.edit", "ترمیم")}
                          onClick={() =>
                            setEditor({
                              base: (skill.baseTaskSlug && getTaskBySlug(skill.baseTaskSlug)) || null,
                              existing: { id: skill.rowId!, label: skill.label, systemPrompt: skill.promptText ?? "" },
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label={t("skills.archive", "آرکائیو")}
                          onClick={() => void archive(skill)}
                        >
                          <Archive className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </>
                    )}
                    <Switch
                      checked={shown}
                      onCheckedChange={(on) => void setHidden(skill.id, !on)}
                      aria-label={skill.label}
                      className="shrink-0"
                    />
                  </div>
                );
              })}
            </section>
          );
        })}
      </CardContent>
      <TaskEditorDialog
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
        baseTask={editor?.base ?? null}
        existing={editor?.existing ?? null}
        onSaved={() => {
          setEditor(null);
          void refreshSkills();
        }}
      />

      <Dialog open={draft !== null} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? t("skills.custom.edit_title", "Edit custom skill") : t("skills.custom.new_title", "New custom skill")}
            </DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <Input
                placeholder={t("skills.custom.title", "Title")}
                aria-label={t("skills.custom.title", "Title")}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <Input
                placeholder={t("skills.custom.trigger", "/trigger (letters, digits, - _)")}
                aria-label={t("skills.custom.trigger", "/trigger (letters, digits, - _)")}
                value={draft.trigger}
                onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}
              />
              <Input
                placeholder={t("skills.custom.keywords", "Keywords, comma-separated")}
                aria-label={t("skills.custom.keywords", "Keywords, comma-separated")}
                value={draft.keywords}
                onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
              />
              <Textarea
                rows={6}
                placeholder={t("skills.custom.guidance", "The skill text — how the agent should do this task")}
                aria-label={t("skills.custom.guidance", "The skill text — how the agent should do this task")}
                value={draft.guidance}
                onChange={(e) => setDraft({ ...draft, guidance: e.target.value })}
              />
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  {t("skills.custom.steps", "Tools to run, in order (click to add or remove)")}
                </p>
                <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                  {AGENT_TOOLS.map((tool) => {
                    const idx = draft.steps.indexOf(tool.name);
                    return (
                      <button
                        key={tool.name}
                        type="button"
                        aria-pressed={idx >= 0}
                        onClick={() => toggleStep(tool.name)}
                        className={`rounded border px-1.5 py-0.5 text-xs ${idx >= 0 ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                      >
                        {idx >= 0 ? `${idx + 1}. ` : ""}{tool.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              {draftErrors.length > 0 && (
                <ul role="alert" className="list-disc ps-5 text-xs text-destructive">
                  {draftErrors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>{t("common.cancel", "Cancel")}</Button>
            <Button onClick={() => void saveDraft()}>{t("common.save", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default SkillsPanel;
