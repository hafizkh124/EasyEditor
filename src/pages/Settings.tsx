import { useEffect } from "react";
import { useSeo } from "@/hooks/useSeo";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AppLayout from "@/components/AppLayout";
import { handleSupabaseError } from "@/lib/errors";
import AppVersionBadge from "@/components/AppVersionBadge";

import { LocalShamelaConnector } from "@/components/mcp/LocalShamelaConnector";
import { ByokKeyPanel } from "@/components/settings/ByokKeyPanel";
import { VoiceEnginePanel } from "@/components/settings/VoiceEnginePanel";
import { AdvancedVoicesPanel } from "@/components/settings/AdvancedVoicesPanel";

// FR-6.1: Settings contains language selection and local MCP companion controls.
const Settings = () => {
  useSeo({ title: "Settings — Al-Ulama Easy Editor", description: "Manage language, theme and account preferences for Al-Ulama Easy Editor.", path: "/settings", noindex: true });

  const { user } = useAuth();
  const { t, language, setLanguage, direction } = useLanguage();

  useEffect(() => {
    if (!user) return;
    const loadPreferredLanguage = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("preferred_language")
        .eq("user_id", user.id)
        .single();
      if (error) { handleSupabaseError(error, "load language"); return; }
      if (data?.preferred_language === "ur" || data?.preferred_language === "en") {
        setLanguage(data.preferred_language);
      }
    };
    loadPreferredLanguage();
  }, [user, setLanguage]);

  const handleLanguageChange = async (value: "en" | "ur") => {
    setLanguage(value);
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ preferred_language: value })
      .eq("user_id", user.id);
    if (error) handleSupabaseError(error, "save language");
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-xl mx-auto space-y-6" dir={direction}>
        <h1 className="text-2xl font-bold text-foreground">{t("settings.title")}</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.language")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="language-select">{t("settings.language")}</Label>
              <Select value={language} onValueChange={(v) => handleLanguageChange(v as "en" | "ur")}>
                <SelectTrigger id="language-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ur">اردو (Urdu)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* BYOK Key Management in Desktop Mode */}
        <ByokKeyPanel />

        {/* Local Voice Studio (Desktop only) */}
        <VoiceEnginePanel />
        <AdvancedVoicesPanel />

        {/* Local Shamela 4 MCP Connector */}
        <LocalShamelaConnector />

        {/* Version Badge */}
        <div className="flex items-center justify-between pt-4 border-t border-border/40">
          <span className="text-xs text-muted-foreground font-medium">App Version & Build:</span>
          <AppVersionBadge />
        </div>
      </div>
    </AppLayout>
  );
};


export default Settings;
