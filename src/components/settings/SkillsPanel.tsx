import { ScrollText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PLAYBOOKS } from "~shared/playbooks/registry";

/**
 * M11 Phase 3 — SkillsPanel (ADR-0047): the 20 playbooks surfaced as
 * "skills" in Settings. Each shows title, /trigger, guidance, step count.
 * Toggle functionality requires a new persistence API (deferred to follow-up).
 * Desktop-only surface.
 */
export function SkillsPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-primary" />
          {"Skills"}
        </CardTitle>
        <CardDescription>
          {"Playbooks available as skills in the / trigger picker."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {PLAYBOOKS.map((pb) => (
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
                  {pb.steps.length} step{pb.steps.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
