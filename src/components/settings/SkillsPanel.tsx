import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Pencil, Plus, ScrollText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { PLAYBOOKS, type Playbook } from "~shared/playbooks/registry";
import { serializeSkillMarkdown } from "~shared/playbooks/parseSkillMarkdown";
import { AGENT_TOOLS } from "~shared/agent/toolSchemas";

/**
 * M11 Phase 3 / M12 Phase H — SkillsPanel (ADR-0047): the playbooks surfaced
 * as "skills" in Settings, each with a real on/off toggle — the GLOBAL layer
 * of the same two-tier persistence Connectors Hub uses (`electron/skills/
 * globalStore.ts` + `.easyeditor/project.json`'s `skills` map, merged by
 * `mergeSkillState`). This used to be read-only ("toggle functionality
 * requires a new persistence API (deferred to follow-up)" — ADR-0047's own
 * text overclaimed the toggle existed).
 *
 * A skill switched off here disappears from BOTH the automatic keyword match
 * AND the explicit `/trigger` / `run_playbook` paths
 * (`shared/playbooks/registry.ts`'s `selectPlaybook`/`resolvePlaybook`) —
 * the same "off means off everywhere" rule Connectors Hub already follows.
 *
 * Custom skills: the scholar can add their own (dialog), import a `skill.md`,
 * and export any custom skill back to `skill.md` (round-trips through Import).
 * A custom skill with the same /trigger as a built-in runs once that built-in
 * is switched off.
 *
 * Desktop-only surface (needs `window.electronAPI.skills`).
 */

interface Draft {
  id?: string;
  title: string;
  trigger: string;
  keywords: string;
  guidance: string;
  steps: string[];
}

const EMPTY_DRAFT: Draft = { title: "", trigger: "", keywords: "", guidance: "", steps: [] };

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SkillsPanel() {
  const { t } = useLanguage();
  const api = typeof window !== "undefined" ? window.electronAPI?.skills : undefined;

  const [merged, setMerged] = useState<Record<string, boolean>>({});
  const [playbooks, setPlaybooks] = useState<Playbook[]>(PLAYBOOKS);
  const [customIds, setCustomIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!api?.list) return;
    try {
      const r = await api.list();
      setMerged(r.merged);
      setPlaybooks(r.playbooks ?? PLAYBOOKS);
      setCustomIds(new Set((r.custom ?? []).map((c) => c.id)));
    } catch {
      // best-effort — the panel just shows every skill as on
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const setEnabled = useCallback(async (id: string, on: boolean) => {
    if (!api?.setEnabled) return;
    setBusyId(id);
    setMerged((m) => ({ ...m, [id]: on }));
    try {
      await api.setEnabled(id, on, "global");
      await load();
    } catch {
      void load();
    } finally {
      setBusyId(null);
    }
  }, [api, load]);

  const saveDraft = useCallback(async () => {
    if (!api?.saveCustom || !draft) return;
    const r = await api.saveCustom({
      id: draft.id,
      title: draft.title,
      trigger: draft.trigger,
      keywords: draft.keywords.split(/[,،]/).map((k) => k.trim()).filter(Boolean),
      guidance: draft.guidance,
      steps: draft.steps,
    });
    if (!r.ok) { setErrors(r.errors); return; }
    setDraft(null);
    setErrors([]);
    await load();
  }, [api, draft, load]);

  const importFile = useCallback(async (file: File | undefined) => {
    if (!api?.saveCustom || !file) return;
    const r = await api.saveCustom({ markdown: await file.text() });
    if (!r.ok) { setErrors(r.errors); setDraft({ ...EMPTY_DRAFT }); return; }
    await load();
  }, [api, load]);

  const removeCustom = useCallback(async (id: string) => {
    if (!api?.deleteCustom) return;
    await api.deleteCustom(id);
    await load();
  }, [api, load]);

  const toggleStep = (tool: string) =>
    setDraft((d) => d && ({
      ...d,
      steps: d.steps.includes(tool) ? d.steps.filter((x) => x !== tool) : [...d.steps, tool],
    }));

  if (!api?.list) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-primary" />
          {t("skills.hub.title", "Skills")}
        </CardTitle>
        <CardDescription>
          {t("skills.hub.subtitle", "Playbooks available in the / trigger picker. Switch one off to hide it from both automatic matching and an explicit /trigger.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => { setErrors([]); setDraft({ ...EMPTY_DRAFT }); }}>
            <Plus className="h-4 w-4 me-1" />
            {t("skills.custom.add", "Add custom skill")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 me-1" />
            {t("skills.custom.import", "Import skill.md")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".md,text/markdown,text/plain"
            className="hidden"
            data-testid="skill-import-input"
            onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>
        <div className="space-y-1">
          {playbooks.map((pb) => {
            const isCustom = customIds.has(pb.id);
            const enabled = merged[pb.id] !== false;
            return (
              <div
                key={pb.id}
                className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-muted"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{pb.title}</span>
                    {pb.trigger && (
                      <code className="text-[0.65rem] bg-muted px-1 py-0.5 rounded text-muted-foreground">
                        /{pb.trigger}
                      </code>
                    )}
                  </div>
                  {pb.guidance && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {pb.guidance}
                    </p>
                  )}
                  <p className="text-[0.65rem] text-muted-foreground/70 mt-0.5">
                    {t("skills.step_count", "{count} steps").replace("{count}", String(pb.steps.length))}
                  </p>
                </div>
                {isCustom && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      aria-label={t("skills.custom.edit", "Edit")}
                      onClick={() => {
                        setErrors([]);
                        setDraft({
                          id: pb.id, title: pb.title, trigger: pb.trigger ?? "",
                          keywords: pb.keywords.join(", "), guidance: pb.guidance ?? "",
                          steps: pb.steps.map((st) => st.tool),
                        });
                      }}
                    ><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      aria-label={t("skills.custom.export", "Export .md")}
                      title={t("skills.custom.export", "Export .md")}
                      onClick={() => downloadText(`${pb.trigger || pb.id}.md`, serializeSkillMarkdown(pb))}
                    ><Download className="h-3.5 w-3.5" /></Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      aria-label={t("skills.custom.delete", "Delete")}
                      onClick={() => void removeCustom(pb.id)}
                    ><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                )}
                <Switch
                  checked={enabled}
                  onCheckedChange={(on) => void setEnabled(pb.id, on)}
                  disabled={busyId === pb.id}
                  aria-label={pb.title}
                  className="shrink-0"
                />
              </div>
            );
          })}
        </div>
      </CardContent>

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
                        className={`rounded border px-1.5 py-0.5 text-[0.65rem] ${idx >= 0 ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                      >
                        {idx >= 0 ? `${idx + 1}. ` : ""}{tool.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              {errors.length > 0 && (
                <ul role="alert" className="list-disc ps-5 text-xs text-destructive">
                  {errors.map((e) => <li key={e}>{e}</li>)}
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
