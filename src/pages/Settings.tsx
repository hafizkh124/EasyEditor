import { useSeo } from "@/hooks/useSeo";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Language } from "@/lib/i18n";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AppLayout from "@/components/AppLayout";
import { handleSupabaseError } from "@/lib/errors";
import AppVersionBadge from "@/components/AppVersionBadge";

import { ConnectorsHub } from "@/components/settings/ConnectorsHub";
import { ShamelaConnectors } from "@/components/mcp/ShamelaConnectors";
import { TafsirConnector } from "@/components/mcp/TafsirConnector";
import { ByokKeyPanel } from "@/components/settings/ByokKeyPanel";
import { VoiceEnginePanel } from "@/components/settings/VoiceEnginePanel";
import { AdvancedVoicesPanel } from "@/components/settings/AdvancedVoicesPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isDesktop } from "@/utils/environment";

// FR-6.1: Settings contains language selection and local MCP companion controls.
const Settings = () => {
  useSeo({ title: "Settings — Al-Ulama Easy Editor", description: "Manage language, theme and account preferences for Al-Ulama Easy Editor.", path: "/settings", noindex: true });

  const { user } = useAuth();
  const { t, language, setLanguage, direction } = useLanguage();

  // The boot-time application of profiles.preferred_language lives in
  // FirstRunLanguageGate, so a fresh device speaks the user's language before
  // the Settings page ever mounts (UX-v1 finding 2.2).

  const handleLanguageChange = async (value: Language) => {
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
              <Select value={language} onValueChange={(v) => handleLanguageChange(v as Language)}>
                <SelectTrigger id="language-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ur">اردو (Urdu)</SelectItem>
                  <SelectItem value="ar">العربية (Arabic)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.appearance")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("settings.appearance_description")}</p>
            <ThemeToggle variant="settings" />
          </CardContent>
        </Card>

        {/* SPEC-M5 FR-2.5: a feature that can't work must be absent, never a
            greyed-out nav entry that only ever fails — capabilityRegistry.test.ts
            enforces that OCR/Translate render on no desktop surface at all. This
            plain-text note (no route, no link) is the one place their existence
            is still discoverable from the desktop app. */}
        {isDesktop() && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{t("settings.web_only_tools_note")}</p>
            </CardContent>
          </Card>
        )}

        {/* BYOK Key Management in Desktop Mode */}
        <ByokKeyPanel />

        {/* Local Voice Studio (Desktop only) */}
        <VoiceEnginePanel />
        <AdvancedVoicesPanel />

        {/* Connectors Hub — the categorised grid over the curated registry.
            The panels below stay as the per-connector connect/download views. */}
        <ConnectorsHub />

        {/* Maktaba Shamela — local library + شامله لنک cloud (ADR-0044) */}
        <ShamelaConnectors />

        {/* Tafsir MCP Connector (remote + local) */}
        <TafsirConnector />

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
