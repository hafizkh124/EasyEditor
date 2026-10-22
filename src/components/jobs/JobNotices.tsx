import { useEffect, useRef } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";
import { onJobFinished, setJobNavigator, wasJobHandled, type Job } from "@/lib/jobs/jobStore";
import "@/lib/jobs/runners";

/**
 * The notice when a long job finishes (SYSTEM-2026 §9): a toast with "Open",
 * and a system notification as well when the app is in the background and
 * the user has allowed them. Mounted once, inside the router.
 */

type T = (key: TranslationKey, fallback?: string) => string;

function notify(job: Job, t: T, navigate: NavigateFunction) {
  if (job.status === "cancelled" || wasJobHandled(job.id)) return;
  const ok = job.status === "done" || job.status === "review";
  const heading = ok ? t("jobs.finished", "کام مکمل ہو گیا") : t("jobs.failed_notice", "کام مکمل نہیں ہو سکا");
  const open = job.href ? { label: t("jobs.open", "کھولیں"), onClick: () => navigate(job.href!) } : undefined;
  if (ok) toast.success(heading, { description: job.title, action: open });
  else toast.error(heading, { description: job.error ? `${job.title} — ${job.error}` : job.title, action: open });

  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      const n = new Notification(heading, { body: job.title, tag: job.id });
      n.onclick = () => {
        window.focus();
        if (job.href) navigate(job.href);
      };
    }
  } catch { /* notifications are a nicety */ }
}

export function JobNotices() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const latest = useRef({ navigate, t });
  latest.current = { navigate, t };

  useEffect(() => {
    setJobNavigator((href, state) => latest.current.navigate(href, { state }));
    return () => setJobNavigator(null);
  }, []);

  useEffect(
    () =>
      onJobFinished((job) => {
        // A tick later, so a screen that shows the result itself can say so first.
        setTimeout(() => notify(job, latest.current.t, latest.current.navigate), 0);
      }),
    [],
  );
  return null;
}
