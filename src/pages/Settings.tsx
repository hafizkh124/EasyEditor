import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { useNavigate } from "react-router-dom";
import { handleSupabaseError } from "@/lib/errors";

const Settings = () => {
  const { user, signOut } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [tier, setTier] = useState("free");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const [{ data: profile, error: profileError }, { data: sub, error: subError }] = await Promise.all([
        supabase.from("profiles").select("display_name, preferred_language").eq("user_id", user.id).single(),
        supabase.from("subscriptions").select("tier").eq("user_id", user.id).single(),
      ]);
      if (profileError) handleSupabaseError(profileError, "load profile");
      if (subError) handleSupabaseError(subError, "load subscription");
      if (profile) {
        setDisplayName(profile.display_name || "");
        if (profile.preferred_language === "ur" || profile.preferred_language === "en") {
          setLanguage(profile.preferred_language as "en" | "ur");
        }
      }
      if (sub) setTier(sub.tier);
    };
    fetch();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    const { error } = await supabase.from("profiles").update({
      display_name: displayName,
      preferred_language: language,
    }).eq("user_id", user.id);
    if (error) { handleSupabaseError(error, "save profile"); return; }
    else toast.success(t("settings.save") + " ✓");
    setIsSaving(false);
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground">{t("settings.title")}</h1>

        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.profile")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("settings.display_name")}</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.language")}</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as "en" | "ur")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ur">اردو (Urdu)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "..." : t("settings.save")}
            </Button>
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.subscription")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("settings.current_plan")}:</span>
              <Badge variant={tier === "pro" ? "default" : "secondary"}>
                {tier === "pro" ? t("settings.pro") : t("settings.free")}
              </Badge>
            </div>
            {tier === "free" && (
              <Link to="/pricing">
                <Button variant="outline" size="sm">{t("dashboard.upgrade")}</Button>
              </Link>
            )}
          </CardContent>
        </Card>

        <Separator />

        <Button variant="destructive" onClick={handleLogout} className="w-full sm:w-auto">
          {t("settings.logout")}
        </Button>
      </div>
    </AppLayout>
  );
};

export default Settings;
