import { Link } from "react-router-dom";
import { AlertTriangle, Bot, CheckCircle2, Languages, ListChecks, Loader2, Play, ScanText, Square, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n";
import {
  canCancel, canResume, cancelJob, clearFinished, isActive, needsUser, removeJob, resumeJob, useJobs, visibleJobs,
  type Job, type JobKind, type JobStatus,
} from "@/lib/jobs/jobStore";
import "@/lib/jobs/runners";

/**
 * The jobs strip (SYSTEM-2026 §9): every long job — transcription, OCR,
 * translation, a large agent task — in one place. At the bottom of the
 * sidebar on a wide screen, at the top of Home on a phone, and as an icon in
 * the workspace's top bar. It shows only while there is something to show.
 */

const KIND_ICON: Record<JobKind, LucideIcon> = { extract: ScanText, translate: Languages, agent: Bot };

const STATUS_LABEL: Record<JobStatus, { key: TranslationKey; fallback: string }> = {
  running: { key: "jobs.status_running", fallback: "جاری" },
  approval: { key: "jobs.status_approval", fallback: "منظوری درکار" },
  review: { key: "jobs.status_review", fallback: "جائزہ" },
  done: { key: "jobs.status_done", fallback: "مکمل" },
  failed: { key: "jobs.status_failed", fallback: "ناکام" },
  interrupted: { key: "jobs.status_interrupted", fallback: "رک گیا" },
  cancelled: { key: "jobs.status_cancelled", fallback: "منسوخ" },
};

function percent(job: Job): number | undefined {
  return job.total ? Math.min(100, (job.current / job.total) * 100) : undefined;
}

function JobRow({ job }: { job: Job }) {
  const { t } = useLanguage();
  const Icon = KIND_ICON[job.kind];
  const status = STATUS_LABEL[job.status];
  const tone =
    job.status === "failed" || job.status === "interrupted" ? "text-destructive"
      : job.status === "approval" || job.status === "review" ? "text-warning"
        : job.status === "done" ? "text-success" : "text-muted-foreground";
  return (
    <li className="space-y-1.5 rounded-lg p-2 hover:bg-muted">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {job.href ? (
          <Link to={job.href} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline">
            {job.title}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{job.title}</span>
        )}
        <span className={cn("shrink-0 text-xs", tone)}>
          {t(status.key, status.fallback)}
          {job.total > 0 && isActive(job) && <span className="tabular-nums"> · {job.current}/{job.total}</span>}
        </span>
        {!isActive(job) && (
          <Button
            size="icon" variant="ghost" className="h-8 w-8 shrink-0"
            onClick={() => removeJob(job.id)}
            aria-label={t("jobs.dismiss", "فہرست سے ہٹائیں")}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
      {isActive(job) && <Progress value={percent(job)} className="h-1" aria-label={job.title} />}
      {job.error && (job.status === "failed" || job.status === "interrupted") && (
        <p className="text-xs text-muted-foreground">{job.error}</p>
      )}
      {job.status === "interrupted" && !job.error && (
        <p className="text-xs text-muted-foreground">{t("jobs.interrupted_hint", "ایپ بند ہونے سے رک گیا۔ جو حصہ ہو چکا وہ دوبارہ نہیں ہوگا۔")}</p>
      )}
      {(canResume(job) || (isActive(job) && canCancel(job.id))) && (
        <div className="flex flex-wrap justify-end gap-1">
          {canResume(job) && (
            <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs" onClick={() => void resumeJob(job.id)}>
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {t("jobs.resume", "جاری رکھیں")}
            </Button>
          )}
          {isActive(job) && canCancel(job.id) && (
            <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => cancelJob(job.id)}>
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              {t("common.cancel", "منسوخ")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function JobsList({ jobs }: { jobs: readonly Job[] }) {
  const { t } = useLanguage();
  const anyFinished = jobs.some((j) => !isActive(j));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 pt-1">
        <h2 className="text-sm font-semibold text-foreground">{t("jobs.title", "جاری کام")}</h2>
        {anyFinished && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearFinished}>
            {t("jobs.clear_finished", "مکمل شدہ ہٹائیں")}
          </Button>
        )}
      </div>
      {jobs.length ? (
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {jobs.map((j) => <JobRow key={j.id} job={j} />)}
        </ul>
      ) : (
        <p className="px-2 pb-2 text-xs text-muted-foreground">{t("jobs.empty", "کوئی کام نہیں")}</p>
      )}
    </div>
  );
}

function summary(jobs: readonly Job[]) {
  const active = jobs.filter(isActive);
  const attention = jobs.filter(needsUser);
  return { active, attention, lead: active[0] ?? attention[0] ?? jobs[0] };
}

/**
 * `sidebar`: a card above the account menu. `home`: the same card, full width
 * (phones). `icon`: a top-bar button (collapsed sidebar, workspace).
 */
export function JobsStrip({ variant, className }: { variant: "sidebar" | "home" | "icon"; className?: string }) {
  const { t } = useLanguage();
  const all = useJobs();
  const jobs = visibleJobs(all);
  if (jobs.length === 0) return null;
  const { active, attention, lead } = summary(jobs);
  const busy = active.length > 0;
  const StateIcon = busy ? Loader2 : attention.length ? AlertTriangle : CheckCircle2;
  const stateTone = busy ? "text-primary" : attention.length ? "text-warning" : "text-success";
  const label = busy
    ? t("jobs.running_count", "{n} کام جاری").replace("{n}", String(active.length))
    : attention.length
      ? t("jobs.attention_count", "{n} کام توجہ چاہتے ہیں").replace("{n}", String(attention.length))
      : t("jobs.all_done", "کام مکمل");

  return (
    <Popover>
      <PopoverTrigger asChild>
        {variant === "icon" ? (
          <Button variant="ghost" size="icon" className={cn("relative h-9 w-9", className)} aria-label={`${t("jobs.title", "جاری کام")}: ${label}`}>
            <StateIcon className={cn("h-4 w-4", stateTone, busy && "animate-spin")} aria-hidden="true" />
            <span className="absolute -top-0.5 end-0 min-w-4 rounded-full bg-primary px-1 text-xs leading-4 text-primary-foreground tabular-nums">
              {active.length || attention.length || jobs.length}
            </span>
          </Button>
        ) : (
          <button
            type="button"
            className={cn(
              "w-full space-y-1.5 rounded-lg border border-border bg-card p-2.5 text-start transition-colors hover:bg-muted",
              className,
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <StateIcon className={cn("h-4 w-4 shrink-0", stateTone, busy && "animate-spin")} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </span>
            {lead && (
              <span className="block truncate text-xs text-muted-foreground">
                {lead.title}
                {isActive(lead) && lead.total > 0 && <span className="tabular-nums"> · {lead.current}/{lead.total}</span>}
              </span>
            )}
            {lead && isActive(lead) && <Progress value={percent(lead)} className="h-1" aria-hidden="true" />}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={variant === "home" ? "center" : "start"} side={variant === "sidebar" ? "top" : "bottom"} className="w-[min(22rem,calc(100vw-2rem))] p-1">
        <JobsList jobs={jobs} />
      </PopoverContent>
    </Popover>
  );
}
