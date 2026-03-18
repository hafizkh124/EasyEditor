import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Mic, BookOpen, Image, Volume2, Clock } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { getRecentActivity, type ActivityEntry } from "@/lib/activityLog";
import { handleSupabaseError } from "@/lib/errors";

const Dashboard = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [subscription, setSubscription] = useState<{
    tier: string;
    transcription_seconds_used: number;
    transcription_limit: number;
  } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    getRecentActivity().then(setRecentActivity).catch(console.error);
  }, []);

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      const [{ data: profile, error: profileError }, { data: sub, error: subError }] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("user_id", user.id).single(),
        supabase.from("subscriptions").select("tier, transcription_seconds_used, transcription_limit").eq("user_id", user.id).single(),
      ]);
      if (profileError) handleSupabaseError(profileError, "load profile");
      if (subError) handleSupabaseError(subError, "load subscription");
      if (profile) setDisplayName(profile.display_name || user.email || "");
      if (sub) setSubscription(sub);
    };
    fetchData();
  }, [user]);

  const usagePercent = subscription
    ? subscription.tier === "pro"
      ? 0
      : (subscription.transcription_seconds_used / subscription.transcription_limit) * 100
    : 0;

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

        {/* Usage Card */}
        {subscription && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{t("dashboard.usage")}</CardTitle>
              <CardDescription>
                {subscription.tier === "pro"
                  ? t("dashboard.unlimited")
                  : `${subscription.transcription_seconds_used} ${t("dashboard.seconds_used")} ${t("dashboard.of")} ${subscription.transcription_limit}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {subscription.tier === "free" && (
                <>
                  <Progress value={usagePercent} className="h-2 mb-3" />
                  <Button variant="outline" size="sm">{t("dashboard.upgrade")}</Button>
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
                    ) : (
                      <Image className="h-3.5 w-3.5 text-accent-foreground" />
                    )}
                  </div>
                  <span className="text-foreground truncate flex-1">{entry.label}</span>
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
