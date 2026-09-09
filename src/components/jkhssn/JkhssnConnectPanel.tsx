import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, XCircle, RefreshCw, GitFork, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useLanguage } from "@/contexts/LanguageContext";
import { useJkhssnAvailability } from "@/hooks/useJkhssnAvailability";
import { logger } from "@/lib/logger";
import type { JkhssnDiagnostics, JkhssnIndexProgress } from "~shared/jkhssn/types";

const log = logger.child("JkhssnConnectPanel");

/**
 * ADR-0045 — the جوامع الكلم connect surface (mirrors ShamelaConnectPanel).
 * Detection is silent (the engine ships a seed); this is where the scholar
 * points at a custom install path and rebuilds the index.
 */
export function JkhssnConnectPanel() {
  const { t } = useLanguage();
  const avail = useJkhssnAvailability();
  const [diag, setDiag] = useState<JkhssnDiagnostics | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [progress, setProgress] = useState<JkhssnIndexProgress | null>(null);
  const autoTried = useRef(false);

  const api = typeof window !== "undefined" ? window.electronAPI?.jkhssn : undefined;

  useEffect(() => {
    api?.diagnose().then(setDiag).catch((err) => log.debug("diagnose failed", { err }));
  }, [api, avail.installed, avail.indexBuilt]);

  const rebuild = useCallback(async () => {
    if (!api || rebuilding) return;
    setRebuilding(true);
    setProgress(null);
    const off = api.onIndexProgress((p) => setProgress(p));
    try {
      const r = await api.rebuildIndex();
      if (r.error) log.warn("rebuild returned error", { error: r.error });
    } catch (err) {
      log.error("rebuild failed", { err });
    } finally {
      off();
      setRebuilding(false);
      setProgress(null);
      avail.refresh();
    }
  }, [api, rebuilding, avail]);

  // First-connect: installed but no index yet → build it once, automatically.
  useEffect(() => {
    if (!autoTried.current && avail.installed && !avail.indexBuilt && !avail.checking && api) {
      autoTried.current = true;
      void rebuild();
    }
  }, [avail.installed, avail.indexBuilt, avail.checking, api, rebuild]);

  if (!api) {
    return <p className="text-xs text-muted-foreground">{t("jkhssn.desktop_only", "جوامع الكلم انجن صرف ڈیسک ٹاپ ایپ میں دستیاب ہے۔")}</p>;
  }

  const badge = avail.available
    ? { label: t("jkhssn.status_ready", "متصل"), cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" }
    : rebuilding
      ? { label: t("jkhssn.status_building", "انڈیکس بن رہا ہے"), cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" }
      : { label: t("jkhssn.status_off", "غیر متصل"), cls: "bg-muted text-muted-foreground border-border" };

  const row = (ok: boolean | null, label: string) => (
    <div className="flex items-center gap-2 text-xs">
      {ok === true ? <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" /> : ok === false ? <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 shrink-0" />}
      <span>{label}</span>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitFork className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{t("jkhssn.title", "جوامع الكلم — تخریج و اسناد")}</span>
        </div>
        <Badge variant="outline" className={badge.cls}>{badge.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border bg-muted p-2.5">
        {row(diag?.catalogFound ?? null, t("jkhssn.check_data", "HadithDB فولڈر"))}
        {row((diag?.readableTables ?? 0) > 0 ? true : diag ? false : null, t("jkhssn.check_tables", "قابلِ مطالعہ جداول"))}
        {row(avail.indexBuilt, t("jkhssn.check_index", "انڈیکس تیار"))}
        {row(avail.indexBuilt ? !avail.indexStale : null, t("jkhssn.check_fresh", "انڈیکس تازہ"))}
      </div>

      {avail.reason && !rebuilding && <p className="text-xs text-muted-foreground">{avail.reason}</p>}

      {rebuilding && (
        <div className="space-y-1">
          <Progress value={progress?.total ? Math.round((progress.done / progress.total) * 100) : undefined} className="h-1.5" />
          <p className="text-xs text-muted-foreground truncate">
            {progress ? `${progress.phase} · ${progress.table} ${progress.total ? `(${progress.done}/${progress.total})` : ""}` : t("jkhssn.building", "شروع ہو رہا ہے…")}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={rebuild} disabled={rebuilding || !avail.installed} className="h-8 text-xs gap-1.5">
          {rebuilding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t("jkhssn.rebuild", "انڈیکس دوبارہ بنائیں")}
        </Button>
        {rebuilding && (
          <Button size="sm" variant="ghost" onClick={() => api.cancelRebuild()} className="h-8 text-xs">
            {t("common.cancel", "منسوخ")}
          </Button>
        )}
      </div>

      {diag && diag.errors.length > 0 && (
        <ul className="space-y-0.5 text-xs text-destructive">
          {diag.errors.map((e, i) => <li key={i}>• {e}</li>)}
        </ul>
      )}
    </div>
  );
}
