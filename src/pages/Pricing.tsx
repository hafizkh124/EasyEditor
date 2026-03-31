import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Crown, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";

const Pricing = () => {
  const { user } = useAuth();
  const { t, direction } = useLanguage();
  const [currentTier, setCurrentTier] = useState<string>("free");
  const [upgradeRequested, setUpgradeRequested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("subscriptions")
      .select("tier, upgrade_requested")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setCurrentTier(data.tier);
          setUpgradeRequested(data.upgrade_requested ?? false);
        }
        setLoading(false);
      });
  }, [user]);

  const requestUpgrade = async () => {
    if (!user) return;
    setRequesting(true);
    const { error } = await supabase
      .from("subscriptions")
      .update({ upgrade_requested: true })
      .eq("user_id", user.id);
    if (error) {
      toast.error(t("pricing.request_error"));
    } else {
      setUpgradeRequested(true);
      toast.success(t("pricing.request_sent"));
    }
    setRequesting(false);
  };

  const features = [
    { key: "pricing.stt", free: "300 " + t("pricing.seconds"), pro: t("pricing.unlimited") },
    { key: "pricing.tts", free: "10,000 " + t("pricing.characters"), pro: t("pricing.unlimited") },
    { key: "pricing.ocr", free: t("pricing.limited"), pro: t("pricing.unlimited") },
    { key: "pricing.research", free: true, pro: true },
    { key: "pricing.voice_clone", free: false, pro: true },
    { key: "pricing.priority_support", free: false, pro: true },
  ];

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-8" dir={direction}>
        <div className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t("pricing.title")}</h1>
          <p className="text-muted-foreground">{t("pricing.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Free Plan */}
          <Card className={currentTier === "free" ? "border-primary/50 ring-2 ring-primary/20" : ""}>
            <CardHeader className="text-center pb-2">
              <div className="flex justify-center mb-2">
                <div className="rounded-full bg-muted p-3">
                  <Zap className="h-6 w-6 text-muted-foreground" />
                </div>
              </div>
              <CardTitle className="text-xl">{t("pricing.free_plan")}</CardTitle>
              <p className="text-3xl font-bold text-foreground mt-2">
                {t("pricing.free_price")}
              </p>
              {currentTier === "free" && (
                <Badge variant="secondary" className="mt-2">{t("pricing.current")}</Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {features.map((f) => (
                <div key={f.key} className="flex items-center gap-2 text-sm">
                  {f.free ? (
                    <Check className="h-4 w-4 text-primary shrink-0" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-foreground">{t(f.key)}</span>
                  {typeof f.free === "string" && (
                    <span className="ms-auto text-xs text-muted-foreground">{f.free}</span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Pro Plan */}
          <Card className={currentTier === "pro" ? "border-primary ring-2 ring-primary/30" : "border-primary/30"}>
            <CardHeader className="text-center pb-2">
              <div className="flex justify-center mb-2">
                <div className="rounded-full bg-primary/10 p-3">
                  <Crown className="h-6 w-6 text-primary" />
                </div>
              </div>
              <CardTitle className="text-xl">{t("pricing.pro_plan")}</CardTitle>
              <p className="text-3xl font-bold text-foreground mt-2">
                {t("pricing.pro_price")}
              </p>
              {currentTier === "pro" && (
                <Badge className="mt-2">{t("pricing.current")}</Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {features.map((f) => (
                <div key={f.key} className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-foreground">{t(f.key)}</span>
                  {typeof f.pro === "string" && (
                    <span className="ms-auto text-xs text-muted-foreground">{f.pro}</span>
                  )}
                </div>
              ))}

              {currentTier === "free" && (
                <div className="pt-4">
                  {upgradeRequested ? (
                    <Button disabled className="w-full">
                      {t("pricing.request_pending")}
                    </Button>
                  ) : (
                    <Button onClick={requestUpgrade} disabled={requesting} className="w-full">
                      {requesting ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
                      {t("pricing.request_upgrade")}
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    {t("pricing.admin_approval_note")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default Pricing;
