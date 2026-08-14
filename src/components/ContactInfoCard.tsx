import { useEffect, useState } from "react";
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
import { MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
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

const ContactInfoCard = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [whatsapp, setWhatsapp] = useState("");
  const [country, setCountry] = useState("");
  const [profession, setProfession] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("whatsapp_number, country, profession")
        .eq("user_id", user.id)
        .single();
      if (!active) return;
      const row = data as {
        whatsapp_number?: string | null;
        country?: string | null;
        profession?: string | null;
      } | null;
      if (row) {
        setWhatsapp(row.whatsapp_number ?? "");
        setCountry(row.country ?? "");
        setProfession(row.profession ?? "");
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (!whatsapp.trim()) {
      toast.error(t("onboarding.validation_whatsapp_required", "WhatsApp number is required."));
      return;
    }
    const normalized = normalizeWhatsAppNumber(whatsapp);
    if (!normalized) {
      toast.error(
        t("onboarding.validation_whatsapp_format", "Please enter a valid WhatsApp number with your country code."),
      );
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        whatsapp_number: normalized,
        country: country.trim().slice(0, 80) || null,
        profession: profession || null,
      })
      .eq("user_id", user.id);
    setSaving(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(t("profile.contact_saved", "Contact information saved."));
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageCircle className="h-5 w-5 text-primary" />
          {t("profile.contact_section", "Contact Information")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="whatsapp-edit">
            {t("onboarding.whatsapp_label", "WhatsApp Number")} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="whatsapp-edit"
            type="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder={t("onboarding.whatsapp_placeholder", "+92 308 4164816")}
            dir="ltr"
          />
          <p className="text-xs text-muted-foreground">
            {t("onboarding.whatsapp_hint", "Include your country code, e.g. +92 308 4164816 or +44 7700 900123.")}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="country-edit">
            {t("onboarding.country_label", "Country / City")}{" "}
            <span className="text-xs text-muted-foreground">
              ({t("onboarding.optional", "optional")})
            </span>
          </Label>
          <Input
            id="country-edit"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder={t("onboarding.country_placeholder", "e.g. Lahore, Pakistan")}
            maxLength={80}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profession-edit">
            {t("onboarding.profession_label", "Profession / Role")}{" "}
            <span className="text-xs text-muted-foreground">
              ({t("onboarding.optional", "optional")})
            </span>
          </Label>
          <Select value={profession} onValueChange={setProfession}>
            <SelectTrigger id="profession-edit">
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

        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {saving && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
          {t("profile.contact_save", "Save")}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ContactInfoCard;
