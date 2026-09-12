import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";
import { PLAYBOOKS } from "~shared/playbooks/registry";

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
 * Desktop-only surface (needs `window.electronAPI.skills`).
 */
export function SkillsPanel() {
  const { t } = useLanguage();
  const api = typeof window !== "undefined" ? window.electronAPI?.skills : undefined;

  const [merged, setMerged] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api?.list) return;
    try {
      const r = await api.list();
      setMerged(r.merged);
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
        <div className="space-y-1">
          {PLAYBOOKS.map((pb) => {
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
    </Card>
  );
}
