import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Database, RefreshCw, Loader2, AlertTriangle, Activity, CheckCircle2, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  fetchCorpusStats,
  fetchIngestJobs,
  fetchCacheCount,
  purgeExpiredCache,
  resetMonthlyQuotas,
  fetchIslamicHealth,
  type CorpusStat,
  type IngestJob,
  type HealthResult,
} from "@/lib/admin/corpus-rpc";
import { useLanguage } from "@/contexts/LanguageContext";

const CorpusPanel = () => {
  const { t } = useLanguage();
  const [corpusStats, setCorpusStats] = useState<CorpusStat[]>([]);
  const [ingestJobs, setIngestJobs] = useState<IngestJob[]>([]);
  const [cacheCount, setCacheCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<HealthResult[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthGeneratedAt, setHealthGeneratedAt] = useState<string | null>(null);

  const runHealthCheck = useCallback(async () => {
    setHealthLoading(true);
    const res = await fetchIslamicHealth();
    if (res.error) toast.error(res.error);
    setHealth(res.results);
    setHealthGeneratedAt(res.generated_at ?? null);
    setHealthLoading(false);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [stats, jobs, count] = await Promise.all([
      fetchCorpusStats(),
      fetchIngestJobs(),
      fetchCacheCount(),
    ]);
    setCorpusStats(stats);
    setIngestJobs(jobs);
    setCacheCount(count);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePurgeCache = async () => {
    const res = await purgeExpiredCache();
    if (!res.ok) { toast.error(res.message ?? "Failed"); return; }
    toast.success(t("admin.cache_purged"));
    fetchData();
  };

  const handleResetQuotas = async () => {
    const res = await resetMonthlyQuotas();
    if (!res.ok) { toast.error(res.message ?? "Failed"); return; }
    toast.success(t("admin.quota_reset_done"));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5" />
              {t("admin.corpus_title")}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t("admin.corpus_refresh")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{t("admin.corpus_loading")}</span>
            </div>
          ) : corpusStats.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">{t("admin.corpus_empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4">{t("admin.corpus_domain")}</th>
                    <th className="pb-2 pr-4">{t("admin.corpus_type")}</th>
                    <th className="pb-2 pr-4 text-right">{t("admin.corpus_total")}</th>
                    <th className="pb-2 pr-4 text-right">{t("admin.corpus_embedded")}</th>
                    <th className="pb-2 min-w-[120px]">{t("admin.corpus_progress")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {corpusStats.map((row, i) => {
                    const pct = row.total > 0 ? Math.round((row.embedded / row.total) * 100) : 0;
                    return (
                      <tr key={i} className="py-2">
                        <td className="py-2 pr-4 font-medium">{row.domain}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{row.source_type}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{row.total.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{row.embedded.toLocaleString()}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-1.5 flex-1" />
                            <span className="text-xs text-muted-foreground w-9 text-right">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td colSpan={2} className="pt-2 text-xs text-muted-foreground">Total</td>
                    <td className="pt-2 text-right tabular-nums text-xs">
                      {corpusStats.reduce((s, r) => s + r.total, 0).toLocaleString()}
                    </td>
                    <td className="pt-2 text-right tabular-nums text-xs">
                      {corpusStats.reduce((s, r) => s + r.embedded, 0).toLocaleString()}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {ingestJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.ingest_jobs_title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3">{t("admin.ingest_job_dataset")}</th>
                    <th className="pb-2 pr-3">{t("admin.ingest_job_status")}</th>
                    <th className="pb-2 pr-3 text-right">{t("admin.ingest_job_processed")}</th>
                    <th className="pb-2 pr-3 text-right">{t("admin.ingest_job_errors")}</th>
                    <th className="pb-2">{t("admin.ingest_job_started")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ingestJobs.map((job) => (
                    <tr key={job.id}>
                      <td className="py-2 pr-3 font-medium">{job.dataset}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={
                          job.status === "done" ? "default" :
                          job.status === "error" ? "destructive" :
                          job.status === "running" ? "secondary" : "outline"
                        } className="text-xs">
                          {job.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{job.processed.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {job.errors > 0
                          ? <span className="text-destructive">{job.errors}</span>
                          : <span className="text-muted-foreground">0</span>
                        }
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {job.started_at ? new Date(job.started_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-5 w-5" />
              Islamic upstream health
            </CardTitle>
            <Button variant="outline" size="sm" onClick={runHealthCheck} disabled={healthLoading} className="gap-1.5">
              {healthLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Run check
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {health.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {healthLoading ? "Probing upstreams…" : "Press Run check to probe every API and RPC."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {health.map((row) => (
                <div key={row.name} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    {row.ok
                      ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                      : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                    <span className="font-medium truncate">{row.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    <span className="tabular-nums">{row.latency_ms} ms</span>
                    <span className="tabular-nums">{row.sample_hits} hits</span>
                    {row.note && <span className="text-destructive truncate max-w-[160px]" title={row.note}>{row.note}</span>}
                  </div>
                </div>
              ))}
              {healthGeneratedAt && (
                <p className="text-xs text-muted-foreground pt-1">
                  Generated {new Date(healthGeneratedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.cache_stats_title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("admin.cache_entries")}</span>
              <span className="font-semibold tabular-nums">
                {cacheCount !== null ? cacheCount.toLocaleString() : "—"}
              </span>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={handlePurgeCache}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("admin.cache_purge")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.quota_reset_title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("admin.quota_reset_btn")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    {t("admin.quota_reset_btn")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("admin.quota_reset_confirm")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("admin.cancel") || "Cancel"}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleResetQuotas}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t("admin.quota_reset_btn")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CorpusPanel;
