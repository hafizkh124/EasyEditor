import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLanguage } from "@/contexts/LanguageContext";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Camera, User, Crown, BarChart3 } from "lucide-react";
import { toast } from "sonner";

const Profile = () => {
  const { user } = useAuth();
  const { subscription, loading: subLoading } = useSubscription();
  const { t, direction } = useLanguage();

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("user_id", user.id)
        .single();
      if (data) {
        setDisplayName(data.display_name ?? "");
        setAvatarUrl(data.avatar_url ?? null);
      }
      setProfileLoading(false);
    };
    fetchProfile();
  }, [user]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("profile.avatar_too_large"));
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error(t("profile.avatar_invalid"));
      return;
    }

    setUploading(true);
    // Sanitize: use user_id + timestamp, ignore original filename
    const ext = (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
    const path = `${user.id}_${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      toast.error(t("profile.avatar_upload_error"));
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    const publicUrl = urlData.publicUrl + `?t=${Date.now()}`;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("user_id", user.id);

    if (updateError) {
      toast.error(t("profile.save_error"));
    } else {
      setAvatarUrl(publicUrl);
      toast.success(t("profile.avatar_updated"));
    }
    setUploading(false);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() || null })
      .eq("user_id", user.id);

    if (error) {
      toast.error(t("profile.save_error"));
    } else {
      toast.success(t("profile.saved"));
    }
    setSaving(false);
  };

  const tier = subscription?.tier ?? "free";
  const tierLabel =
    tier === "ultra" ? t("settings.ultra") : tier === "pro" ? t("settings.pro") : t("settings.free");

  const meters = subscription
    ? [
        {
          label: t("dashboard.stt_label"),
          used: subscription.transcription_seconds_used ?? 0,
          limit: subscription.transcription_limit ?? 300,
          unit: t("pricing.seconds"),
        },
        {
          label: t("dashboard.tts_label"),
          used: subscription.tts_characters_used ?? 0,
          limit: subscription.tts_character_limit ?? 10_000,
          unit: t("pricing.characters"),
        },
        {
          label: t("dashboard.ocr_label"),
          used: subscription.ocr_pages_used ?? 0,
          limit: subscription.ocr_pages_limit ?? 5,
          unit: t("dashboard.pages_used"),
        },
        {
          label: t("dashboard.research_label"),
          used: subscription.research_queries_used ?? 0,
          limit: subscription.research_queries_limit ?? 3,
          unit: t("dashboard.queries_used"),
        },
      ]
    : [];

  const isUnlimited = (limit: number) => limit >= 999_999;

  if (profileLoading || subLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  const initials = displayName
    ? displayName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : (user?.email?.[0] ?? "?").toUpperCase();

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6" dir={direction}>
        <div className="flex items-center gap-3">
          <User className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{t("profile.title")}</h1>
        </div>

        {/* Profile Edit Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("profile.edit_profile")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar */}
            <div className="flex items-center gap-5">
              <div className="relative">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={avatarUrl ?? undefined} alt={displayName || "Avatar"} />
                  <AvatarFallback className="text-xl font-semibold">{initials}</AvatarFallback>
                </Avatar>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="absolute -bottom-1 -end-1 rounded-full bg-primary text-primary-foreground p-1.5 shadow-md hover:bg-primary/90 transition-colors disabled:opacity-60"
                  aria-label={t("profile.change_avatar")}
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarUpload}
                />
              </div>
              <div className="space-y-0.5">
                <p className="font-medium text-foreground">{displayName || t("admin.unnamed")}</p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
                <p className="text-xs text-muted-foreground">{t("profile.avatar_hint")}</p>
              </div>
            </div>

            {/* Display Name */}
            <div className="space-y-1.5">
              <Label htmlFor="displayName">{t("settings.display_name")}</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("admin.unnamed")}
                onKeyDown={(e) => e.key === "Enter" && !saving && handleSave()}
              />
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
              {saving && <Loader2 className="h-4 w-4 animate-spin me-2" />}
              {t("settings.save")}
            </Button>
          </CardContent>
        </Card>

        {/* Subscription Summary Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BarChart3 className="h-5 w-5" />
              {t("profile.usage_summary")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">{t("settings.current_plan")}:</span>
              <Badge variant={tier === "free" ? "secondary" : "default"}>{tierLabel}</Badge>
            </div>

            {meters.map((m) => (
              <div key={m.label} className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-foreground">{m.label}</span>
                  <span className="text-muted-foreground">
                    {isUnlimited(m.limit)
                      ? `${m.used.toLocaleString()} ${m.unit}`
                      : `${m.used.toLocaleString()} / ${m.limit.toLocaleString()} ${m.unit}`}
                  </span>
                </div>
                <Progress
                  value={isUnlimited(m.limit) ? 5 : Math.min((m.used / m.limit) * 100, 100)}
                  className="h-2"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Profile;
