import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, UserPlus, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { normalizeWhatsAppNumber } from "@/lib/phoneValidation";

const PROFESSION_OPTIONS = [
  { value: "imam", labelKey: "onboarding.profession_imam" },
  { value: "teacher", labelKey: "onboarding.profession_teacher" },
  { value: "student", labelKey: "onboarding.profession_student" },
  { value: "researcher", labelKey: "onboarding.profession_researcher" },
  { value: "other", labelKey: "onboarding.profession_other" },
];

const CompleteProfile = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, profileComplete, loading: approvalLoading, refetch } = useApproval();
  const { t, direction } = useLanguage();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [country, setCountry] = useState("");
  const [profession, setProfession] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Pre-fill from existing profile (display_name from signup, etc.)
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, whatsapp_number, country, profession")
        .eq("user_id", user.id)
        .single();
      if (!active) return;
      const row = data as {
        display_name?: string | null;
        whatsapp_number?: string | null;
        country?: string | null;
        profession?: string | null;
      } | null;
      if (row) {
        // If display_name looks like an email, don't pre-fill — the user
        // should provide a real name.
        const looksLikeEmail = (row.display_name ?? "").includes("@");
        setFullName(looksLikeEmail ? "" : (row.display_name ?? ""));
        setWhatsapp(row.whatsapp_number ?? "");
        setCountry(row.country ?? "");
        setProfession(row.profession ?? "");
      }
      setInitialLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user]);

  if (authLoading || approvalLoading || initialLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  // Admins skip this page entirely — they're the team, not the audience.
  if (isAdmin) return <Navigate to="/dashboard" replace />;
  // Already complete → onward (PendingApproval or Dashboard depending on approval).
  if (profileComplete === true) return <Navigate to="/pending-approval" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      toast.error(t("onboarding.validation_name_required", "Please enter your full name."));
      return;
    }
    if (!whatsapp.trim()) {
      toast.error(t("onboarding.validation_whatsapp_required", "Please enter your WhatsApp number."));
      return;
    }
    const normalized = normalizeWhatsAppNumber(whatsapp);
    if (!normalized) {
      toast.error(
        t("onboarding.validation_whatsapp_format", "Please enter a valid WhatsApp number with your country code."),
      );
      return;
    }

    setSubmitting(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: trimmedName.slice(0, 80),
        whatsapp_number: normalized,
        country: country.trim().slice(0, 80) || null,
        profession: profession || null,
      })
      .eq("user_id", user.id);
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(t("onboarding.saved", "Profile saved!"));
    await refetch();
    navigate("/pending-approval", { replace: true });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir={direction}>
      <div className="max-w-xl mx-auto">
        <Card>
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              <CardTitle className="text-xl">
                {t("onboarding.title", "Complete Your Profile")}
              </CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("onboarding.intro", "We need to be able to contact you about your subscription. Please share your WhatsApp number — our team will reach out for payment confirmation and support.")}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">
                  {t("onboarding.full_name_label", "Full Name")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t("onboarding.full_name_placeholder", "e.g. Hafiz Muhammad Ali")}
                  maxLength={80}
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="whatsapp">
                  {t("onboarding.whatsapp_label", "WhatsApp Number")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="whatsapp"
                  type="tel"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder={t("onboarding.whatsapp_placeholder", "+92 308 4164816")}
                  required
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  {t("onboarding.whatsapp_hint", "Include your country code, e.g. +92 308 4164816 or +44 7700 900123.")}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="country">
                  {t("onboarding.country_label", "Country / City")}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({t("onboarding.optional", "optional")})
                  </span>
                </Label>
                <Input
                  id="country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder={t("onboarding.country_placeholder", "e.g. Lahore, Pakistan")}
                  maxLength={80}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="profession">
                  {t("onboarding.profession_label", "Profession / Role")}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({t("onboarding.optional", "optional")})
                  </span>
                </Label>
                <Select value={profession} onValueChange={setProfession}>
                  <SelectTrigger id="profession">
                    <SelectValue
                      placeholder={t("onboarding.profession_placeholder", "Select your role")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {PROFESSION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {t(opt.labelKey as import("@/lib/i18n").TranslationKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                {submitting
                  ? t("onboarding.saving", "Saving…")
                  : t("onboarding.submit", "Continue")}
              </Button>
            </form>

            <div className="mt-4 pt-4 border-t border-border text-center">
              <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground">
                <LogOut className="h-3.5 w-3.5 me-2" />
                {t("onboarding.sign_out", "Sign Out")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CompleteProfile;
