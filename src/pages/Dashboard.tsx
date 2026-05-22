import { useEffect, useState } from "react";
import { useSeo } from "@/hooks/useSeo";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { Mic, BookOpen, Image, Volume2, Clock, CalendarClock, AlertTriangle, MessageCircle } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { getRecentActivity, type ActivityEntry } from "@/lib/activityLog";
import { handleSupabaseError } from "@/lib/errors";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useApproval } from "@/hooks/useApproval";
import { getLifecycleInfo, formatLifecycleDate } from "@/lib/subscriptionLifecycle";
import { WHATSAPP_CONTACT_URL } from "@/lib/paymentAccounts";
import { getUpgradeLabelKey } from "@/lib/tierUpgrade";
import TokenMeter from "@/components/TokenMeter";

const Dashboard = () => {
  useSeo({ title: "Dashboard — Al-Ulama Easy Editor", description: "Your Al-Ulama Easy Editor home: recent activity, usage limits and shortcuts to every tool.", path: "/dashboard" });

  const { user } = useAuth();
  const { t } = useLanguage();
  const { subscription } = useSubscription();
  const { isAdmin } = useApproval();
  const [displayName, setDisplayName] = useState("");
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);

  // P6: Pass userId to avoid redundant getSession() call inside getRecentActivity
  useEffect(() => {
    getRecentActivity(user?.id).then(setRecentActivity).catch(console.error);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .single();
      if (profileError) handleSupabaseError(profileError, "load profile");
      if (profile) setDisplayName(profile.display_name || user.email || "");
    };
    fetchProfile();
  }, [user]);

  const isUnlimited = (subscription?.transcription_limit ?? 0) >= 999_999;

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
  const renewalMessage = encodeURIComponent(
    t("dashboard.renewal_whatsapp_template") ||
      "Assalam-o-Alaikum, I would like to renew my subscription.",
  );

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t("dashboard.welcome")}</h1>
          <p className="text-muted-foreground mt-1">{displayName ? `👋 ${displayName}` : t("dashboard.subtitle")}</p>
        </div>

        {/* Subscription Lifecycle Card */}
        {lifecycle && lifecycle.status !== "none" && (
          <Card
            className={
              lifecycle.status === "expired"
                ? "border-destructive/40 bg-destructive/5"
                : lifecycle.status === "expiring_soon"
                ? "border-amber-400/40 bg-amber-50 dark:bg-amber-950/20"
                : undefined
            }
          >
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
              <div className="flex items-start gap-3 min-w-0">
                {lifecycle.status === "expired" || lifecycle.status === "expiring_soon" ? (
                  <AlertTriangle
                    className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                      lifecycle.status === "expired" ? "text-destructive" : "text-amber-600"
                    }`}
                  />
                ) : (
                  <CalendarClock className="h-5 w-5 flex-shrink-0 mt-0.5 text-primary" />
                )}
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-medium">
                    {lifecycle.status === "expired"
                      ? t("dashboard.subscription_expired") || "Your subscription has expired"
                      : lifecycle.status === "expiring_soon"
                      ? (t("dashboard.expiring_soon") || "Subscription expires in {n} day(s)").replace(
                          "{n}",
                          String(lifecycle.daysRemaining ?? 0),
                        )
                      : t("dashboard.subscription_active") || "Subscription Active"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(t("dashboard.activated_label") || "Activated") + ": " + formatLifecycleDate(lifecycle.activatedAt)}
                    {" • "}
                    {(t("dashboard.expires_label") || "Expires") + ": " + formatLifecycleDate(lifecycle.expiresAt)}
                  </p>
                </div>
              </div>
              {(lifecycle.status === "expired" || lifecycle.status === "expiring_soon") && (
                <Button asChild variant="default" className="flex-shrink-0">
                  <a
                    href={`${WHATSAPP_CONTACT_URL}?text=${renewalMessage}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="h-4 w-4 me-2" />
                    {t("dashboard.contact_renew") || "Contact Admin to Renew"}
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Token Usage Card */}
        {subscription && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{t("dashboard.usage")}</CardTitle>
              {isUnlimited && (
                <CardDescription>{t("dashboard.unlimited")}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {isUnlimited ? null : (
                <>
                  <TokenMeter />
                  {(() => {
                    const upgradeKey = getUpgradeLabelKey(subscription.tier);
                    return upgradeKey ? (
                      <Link to="/pricing">
                        <Button variant="outline" size="sm">{t(upgradeKey)}</Button>
                      </Link>
                    ) : null;
                  })()}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tools Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link to="/transcribe">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Mic className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{t("stt.title")}</CardTitle>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/speak">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Volume2 className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{t("dashboard.tts")}</CardTitle>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/ocr">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Image className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{t("dashboard.ocr")}</CardTitle>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/research">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <BookOpen className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{t("dashboard.research_assistant")}</CardTitle>
                </div>
              </CardHeader>
            </Card>
          </Link>
        </div>

        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                {t("dashboard.recent_activity")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentActivity.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 text-sm">
                  <div className={`rounded p-1 ${entry.type === "tts" ? "bg-primary/10" : "bg-accent"}`}>
                    {entry.type === "tts" ? (
                      <Volume2 className="h-3.5 w-3.5 text-primary" />
                    ) : entry.type === "stt" ? (
                      <Mic className="h-3.5 w-3.5 text-accent-foreground" />
                    ) : entry.type === "research" || entry.type === "islamic" ? (
                      <BookOpen className="h-3.5 w-3.5 text-accent-foreground" />
                    ) : (
                      <Image className="h-3.5 w-3.5 text-accent-foreground" />
                    )}
                  </div>
                  <span className="text-foreground truncate flex-1">{entry.label}</span>
                  {entry.tokensSpent != null && entry.tokensSpent > 0 && (
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {entry.tokensSpent} tokens
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(entry.timestamp)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
