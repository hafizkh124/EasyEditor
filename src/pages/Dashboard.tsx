import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Mic, BookOpen, Image, Volume2 } from "lucide-react";
import AppLayout from "@/components/AppLayout";

const Dashboard = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [subscription, setSubscription] = useState<{
    tier: string;
    transcription_seconds_used: number;
    transcription_limit: number;
  } | null>(null);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      const [{ data: profile }, { data: sub }] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("user_id", user.id).single(),
        supabase.from("subscriptions").select("tier, transcription_seconds_used, transcription_limit").eq("user_id", user.id).single(),
      ]);
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

          {[
            { icon: BookOpen, label: t("dashboard.research_assistant") },
            { icon: Image, label: t("dashboard.ocr") },
            { icon: Volume2, label: t("dashboard.tts") },
          ].map((tool) => (
            <Card key={tool.label} className="opacity-60 h-full">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-muted p-2">
                    <tool.icon className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{tool.label}</CardTitle>
                    <CardDescription className="text-xs">{t("dashboard.coming_soon")}</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
