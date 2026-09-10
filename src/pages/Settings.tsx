import { useState } from "react";
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
import { cn } from "@/lib/utils";

import { SkillsPanel } from "@/components/settings/SkillsPanel";
import { ConnectorsHub } from "@/components/settings/ConnectorsHub";
import { ShamelaConnectors } from "@/components/mcp/ShamelaConnectors";
import { TafsirConnector } from "@/components/mcp/TafsirConnector";
import { ByokKeyPanel } from "@/components/settings/ByokKeyPanel";
import { VoiceEnginePanel } from "@/components/settings/VoiceEnginePanel";
import { AdvancedVoicesPanel } from "@/components/settings/AdvancedVoicesPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isDesktop } from "@/utils/environment";
import { ScrollText, Plug, Mic, Key, Palette, BookOpen, SettingsIcon } from "lucide-react";

type SettingsSection = "general" | "skills" | "connectors" | "voice" | "keys" | "methods";

const SECTIONS: Array<{ id: SettingsSection; icon: typeof ScrollText; labelKey: string; fallback: string }> = [
  { id: "general", icon: Palette, labelKey: "settings.nav_general", fallback: "General" },
  { id: "skills", icon: ScrollText, labelKey: "settings.nav_skills", fallback: "Skills" },
  { id: "connectors", icon: Plug, labelKey: "settings.nav_connectors", fallback: "Connectors" },
  { id: "voice", icon: Mic, labelKey: "settings.nav_voice", fallback: "Voice" },
  { id: "keys", icon: Key, labelKey: "settings.nav_keys", fallback: "Keys (BYOK)" },
  { id: "methods", icon: BookOpen, labelKey: "settings.nav_methods", fallback: "Methods" },
];

// FR-6.1: Settings contains language selection and local MCP companion controls.
// M11 Phase 3: sidebar navigation with section-based layout (ADR-0047).
const Settings = () => {
  useSeo({ title: "Settings — Al-Ulama Easy Editor", description: "Manage language, theme and account preferences for Al-Ulama Easy Editor.", path: "/settings", noindex: true });

  const { user } = useAuth();
  const { t, language, setLanguage, direction } = useLanguage();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

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
      <div className="flex h-full" dir={direction}>
        {/* Sidebar Navigation */}
        <nav className="w-48 shrink-0 border-e border-border bg-sidebar p-3 hidden md:block">
          <div className="flex items-center gap-2 mb-4 px-2">
            <SettingsIcon className="h-4 w-4 text-primary" />
            <span className="font-semibold text-xs tracking-wide uppercase">{t("settings.title")}</span>
          </div>
          <div className="space-y-0.5">
            {SECTIONS.map(({ id, icon: Icon, labelKey, fallback }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors",
                  activeSection === id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t(labelKey as import("@/lib/i18n").TranslationKey, fallback)}
              </button>
            ))}
          </div>
        </nav>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Mobile section selector */}
            <div className="md:hidden">
              <Select value={activeSection} onValueChange={(v) => setActiveSection(v as SettingsSection)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECTIONS.map(({ id, labelKey, fallback }) => (
                    <SelectItem key={id} value={id}>
                      {t(labelKey as import("@/lib/i18n").TranslationKey, fallback)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <h1 className="text-2xl font-bold text-foreground">{t("settings.title")}</h1>

            {/* ── General ── */}
            {activeSection === "general" && (
              <>
                <Card id="general">
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

                {isDesktop() && (
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">{t("settings.web_only_tools_note")}</p>
                    </CardContent>
                  </Card>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-border/40">
                  <span className="text-xs text-muted-foreground font-medium">App Version & Build:</span>
                  <AppVersionBadge />
                </div>
              </>
            )}

            {/* ── Skills ── */}
            {activeSection === "skills" && <SkillsPanel />}

            {/* ── Connectors ── */}
            {activeSection === "connectors" && (
              <>
                <div id="connectors">
                  <ConnectorsHub />
                </div>
                <ShamelaConnectors />
                <TafsirConnector />
              </>
            )}

            {/* ── Voice ── */}
            {activeSection === "voice" && (
              <>
                <VoiceEnginePanel />
                <AdvancedVoicesPanel />
              </>
            )}

            {/* ── Keys (BYOK) ── */}
            {activeSection === "keys" && <ByokKeyPanel />}

            {/* ── Methods ── */}
            {activeSection === "methods" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-primary" />
                    {"Research Methods"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-muted-foreground">
                  <p>{"Documentation of how the agent searches, grades, and cites sources."}</p>
                  <p className="text-xs">{"Full methods page coming in a future update."}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};


export default Settings;
