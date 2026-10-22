import { useEffect, useState } from "react";
import { useSeo } from "@/hooks/useSeo";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFormatDate } from "@/lib/formatDate";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowUp, FileText, MessageCircle, MessageSquareText } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { JobsStrip } from "@/components/jobs/JobsStrip";
import { handleSupabaseError } from "@/lib/errors";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useApproval } from "@/hooks/useApproval";
import { useRecentItems } from "@/hooks/useRecentItems";
import { useCreateActions } from "@/components/layout/useCreateActions";
import { getLifecycleInfo } from "@/lib/subscriptionLifecycle";
import { WHATSAPP_CONTACT_URL } from "@/lib/paymentAccounts";
import { getUpgradeLabelKey } from "@/lib/tierUpgrade";
import TokenMeter from "@/components/TokenMeter";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Home (SYSTEM-2026 §3, design v3/01-home). One question box, the three core
 * jobs, and a single recent list mixing chats and documents. Kept at
 * /dashboard, which the mobile Chat/Write tab opens.
 *
 * The job cards read the same list as the "+" menu (`useCreateActions`), so a
 * job that cannot run on this runtime is absent here too.
 */

const RECENT_LIMIT = 8;

const JOB_TINT: Record<string, string> = {
  transcribe: "bg-info-soft text-info",
  ocr: "bg-warning-soft text-warning",
  "translate.book": "bg-success-soft text-success",
};

const JOB_DESC: Record<string, { key: TranslationKey; fallback: string }> = {
  transcribe: { key: "home.job_desc.transcribe", fallback: "بیان، وائس نوٹ، ویڈیو" },
  ocr: { key: "home.job_desc.ocr", fallback: "کتاب کے صفحات، اسکین، PDF" },
  "translate.book": { key: "home.job_desc.translate", fallback: "PDF یا شاملہ کی کتاب" },
};


const Dashboard = () => {
  useSeo({ title: "Home — Al-Ulama Easy Editor", description: "Ask a question, start a job, or pick up where you left off.", path: "/dashboard", noindex: true });

  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { subscription } = useSubscription();
  const { isAdmin } = useApproval();
  const [displayName, setDisplayName] = useState("");
  const [question, setQuestion] = useState("");
  const jobs = useCreateActions().filter((a) => a.group === "job");

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .single();
      if (profileError) handleSupabaseError(profileError, "load profile");
      if (profile) setDisplayName(profile.display_name || "");
    };
    fetchProfile();
  }, [user]);

  const { items: recent, loading: recentLoading } = useRecentItems(RECENT_LIMIT);

  // Lifecycle dates were added in Phase B; cast to read them safely while the
  // generated types catch up.
  const subWithLifecycle = subscription as (typeof subscription & {
    activated_at?: string | null;
    expires_at?: string | null;
  }) | null;
  const lifecycle = subWithLifecycle
    ? getLifecycleInfo({
        tier: subWithLifecycle.tier,
        activatedAt: subWithLifecycle.activated_at ?? null,
        expiresAt: subWithLifecycle.expires_at ?? null,
        // Admins / team members are exempt from subscription expiry.
        exemptFromExpiry: isAdmin,
      })
    : null;
  const lifecycleAlert = lifecycle && (lifecycle.status === "expired" || lifecycle.status === "expiring_soon") ? lifecycle : null;
  const renewalMessage = encodeURIComponent(
    t("dashboard.renewal_whatsapp_template", "Assalam-o-Alaikum, I would like to renew my subscription."),
  );
  const isUnlimited = (subscription?.transcription_limit ?? 0) >= 999_999;
  const upgradeKey = subscription ? getUpgradeLabelKey(subscription.tier) : null;

  const ask = () => {
    const text = question.trim();
    if (!text) return;
    navigate("/workspace?panel=research", { state: { question: text } });
  };

  const formatDate = useFormatDate();

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
        {/* Long jobs (SYSTEM-2026 §9). Wide screens have them at the bottom of the sidebar. */}
        <div className="md:hidden empty:hidden">
          <JobsStrip variant="home" />
        </div>
        <header className="space-y-1 pt-2 text-center md:pt-6">
          <h1 className="text-2xl font-bold text-foreground md:text-3xl">
            {t("home.greeting", "السلام علیکم، آج کیا کرنا ہے؟")}
          </h1>
          {displayName && <p className="text-muted-foreground">{displayName}</p>}
        </header>

        {lifecycleAlert && (
          <div
            role="status"
            className={cn(
              "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between",
              lifecycleAlert.status === "expired"
                ? "border-destructive-border bg-destructive-soft"
                : "border-warning-border bg-warning-soft",
            )}
          >
            <p className="flex items-start gap-2 text-sm font-medium">
              <AlertTriangle
                className={cn("mt-0.5 h-4 w-4 shrink-0", lifecycleAlert.status === "expired" ? "text-destructive" : "text-warning")}
                aria-hidden="true"
              />
              {lifecycleAlert.status === "expired"
                ? t("dashboard.subscription_expired", "Your subscription has expired")
                : t("dashboard.expiring_soon", "Subscription expires in {n} day(s)").replace("{n}", String(lifecycleAlert.daysRemaining ?? 0))}
            </p>
            <Button asChild size="sm" className="shrink-0">
              <a href={`${WHATSAPP_CONTACT_URL}?text=${renewalMessage}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="me-2 h-4 w-4" aria-hidden="true" />
                {t("dashboard.contact_renew", "Contact Admin to Renew")}
              </a>
            </Button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
          className="rounded-2xl border border-border bg-card p-2 shadow-md transition-shadow focus-within:ring-2 focus-within:ring-ring"
        >
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask();
              }
            }}
            rows={2}
            aria-label={t("home.ask_placeholder", "سوال پوچھیں…")}
            placeholder={t("home.ask_placeholder", "سوال پوچھیں…")}
            className="min-h-[4.5rem] resize-none border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
          />
          <div className="flex justify-end">
            <Button type="submit" size="icon" disabled={!question.trim()} aria-label={t("home.ask_submit", "پوچھیں")}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </form>

        {jobs.length > 0 && (
          <div className={cn("grid gap-3", jobs.length >= 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
            {jobs.map((job) => {
              const desc = JOB_DESC[job.id];
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={job.run}
                  className="flex min-h-touch items-center gap-3 rounded-xl border border-border bg-card p-4 text-start shadow-xs transition-colors duration-fast hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:items-start"
                >
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", JOB_TINT[job.id] ?? "bg-muted text-muted-foreground")}>
                    <job.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-foreground">{job.label}</span>
                    {desc && <span className="block text-sm text-muted-foreground">{t(desc.key, desc.fallback)}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <section aria-labelledby="home-recent" className="space-y-2">
          <h2 id="home-recent" className="text-sm font-semibold text-muted-foreground">
            {t("home.recent", "حالیہ")}
          </h2>
          {recentLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t("home.recent_empty", "آپ کی چیٹس اور دستاویزات یہاں نظر آئیں گی۔")}
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {recent.map((item) => {
                const Icon = item.kind === "chat" ? MessageSquareText : FileText;
                const typeLabel = item.kind === "chat" ? t("home.type_chat", "چیٹ") : t("home.type_document", "دستاویز");
                return (
                  <li key={item.id}>
                    <Link
                      to={item.to}
                      className="flex min-h-touch items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={typeLabel} />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {item.title || t("editor.untitled", "بے عنوان")}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDate(item.updatedAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {subscription && !isUnlimited && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <TokenMeter />
              {upgradeKey && (
                <Button asChild variant="outline" size="sm">
                  <Link to="/pricing">{t(upgradeKey as TranslationKey)}</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
