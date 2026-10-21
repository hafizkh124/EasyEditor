import { useState } from "react";
import { Archive, Copy, Pencil, Plus, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";
import { TaskEditorDialog } from "@/components/workspace/TaskEditorDialog";
import { BUILTIN_TASKS, getTaskBySlug } from "@/lib/tasks/registry";
import { customTaskService } from "@/lib/tasks/customTasks";
import type { TaskDefinition } from "@/lib/tasks/types";
import { useSkills, refreshSkills } from "@/lib/skills/useSkills";
import type { Skill } from "@/lib/skills/types";
import type { TranslationKey } from "@/lib/i18n";
import { PLAYBOOKS } from "~shared/playbooks/registry";

/**
 * Settings → Skills (SYSTEM-2026 §7): every skill in one list, on web and
 * desktop alike. Each can be shown or hidden in the `/` menus; my skills can be
 * created (from a built-in), edited and archived here. "Manage skills" at the
 * end of every `/` menu opens this page.
 *
 * Hiding a playbook switches it off in the desktop skills store — the same
 * switch the agent obeys for keyword matching and an explicit `/trigger`.
 */

const GROUPS: { key: string; titleKey: TranslationKey; fallback: string; match: (s: Skill) => boolean }[] = [
  { key: "guided", titleKey: "skills.group_guided", fallback: "سوال جواب", match: (s) => s.kind === "guided" },
  { key: "mine", titleKey: "skills.group_mine", fallback: "میری مہارتیں", match: (s) => s.origin === "mine" },
  { key: "edit", titleKey: "skills.group_edit", fallback: "متن کی مہارتیں", match: (s) => s.kind === "edit" && s.origin === "builtin" },
  { key: "prompt", titleKey: "skills.group_prompt", fallback: "علمی پرامپٹس", match: (s) => s.kind === "prompt" },
  { key: "workflow", titleKey: "skills.group_workflow", fallback: "کئی مراحل والی", match: (s) => s.kind === "workflow" },
];

export function SkillsPanel() {
  const { t } = useLanguage();
  const { skills, isHidden, setHidden } = useSkills();
  const [editor, setEditor] = useState<{ base: TaskDefinition | null; existing: { id: string; label: string; systemPrompt: string } | null } | null>(null);

  const placeLabel = (place: string) =>
    place === "editor" ? t("skills.place_editor", "ایڈیٹر") : t("skills.place_chat", "چیٹ");

  const archive = async (skill: Skill) => {
    if (!skill.rowId) return;
    const ok = await customTaskService.archive(skill.rowId).catch(() => false);
    if (!ok) toast.error(t("skills.archive_failed"));
    await refreshSkills();
  };

  const stepCount = (skill: Skill) => PLAYBOOKS.find((p) => p.id === skill.playbookId)?.steps.length;

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
        <Button size="sm" className="gap-2" onClick={() => setEditor({ base: BUILTIN_TASKS[0], existing: null })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("skills.new", "نئی مہارت")}
        </Button>
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
    </Card>
  );
}

export default SkillsPanel;
