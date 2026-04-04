import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Crown, Zap, Loader2, Sparkles, Shield, Star } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { motion } from "framer-motion";

const MotionCard = motion(Card);

const Pricing = () => {
  const { user } = useAuth();
  const { t, direction } = useLanguage();
  const { subscription, loading, refetch } = useSubscription();
  const currentTier = subscription?.tier ?? "free";
  // Local optimistic state: set true immediately on success, synced from context on load
  const [upgradeRequested, setUpgradeRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (subscription) {
      setUpgradeRequested(subscription.upgrade_requested ?? false);
    }
  }, [subscription]);

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
      refetch();
    }
    setRequesting(false);
  };

  const features = [
    { key: "pricing.stt", free: "300 " + t("pricing.seconds"), pro: t("pricing.unlimited"), icon: Sparkles },
    { key: "pricing.tts", free: "10,000 " + t("pricing.characters"), pro: t("pricing.unlimited"), icon: Star },
    { key: "pricing.ocr", free: t("pricing.limited"), pro: t("pricing.unlimited"), icon: Shield },
    { key: "pricing.research", free: true, pro: true, icon: Sparkles },
    { key: "pricing.voice_clone", free: false, pro: true, icon: Star },
    { key: "pricing.priority_support", free: false, pro: true, icon: Shield },
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
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-10" dir={direction}>
        {/* Header */}
        <motion.div
          className="text-center space-y-3"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex justify-center mb-4">
            <motion.div
              className="rounded-full bg-primary/10 p-4"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Crown className="h-8 w-8 text-primary" />
            </motion.div>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
            {t("pricing.title")}
          </h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">
            {t("pricing.subtitle")}
          </p>
        </motion.div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Free Plan */}
          <MotionCard
            className={`relative overflow-hidden transition-shadow duration-300 hover:shadow-lg ${
              currentTier === "free"
                ? "border-primary/50 ring-2 ring-primary/20"
                : "border-border"
            }`}
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <CardHeader className="text-center pb-4 pt-8">
              <motion.div
                className="flex justify-center mb-4"
                whileHover={{ rotate: 15 }}
                transition={{ type: "spring", stiffness: 300 }}
              >
                <div className="rounded-2xl bg-muted p-4">
                  <Zap className="h-8 w-8 text-muted-foreground" />
                </div>
              </motion.div>
              <CardTitle className="text-2xl">{t("pricing.free_plan")}</CardTitle>
              <p className="text-4xl font-bold text-foreground mt-3">
                {t("pricing.free_price")}
              </p>
              {currentTier === "free" && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
                  <Badge variant="secondary" className="mt-3 text-sm px-3 py-1">
                    {t("pricing.current")}
                  </Badge>
                </motion.div>
              )}
            </CardHeader>
            <CardContent className="space-y-1 pb-8">
              {features.map((f, i) => (
                <motion.div
                  key={f.key}
                  className={`flex items-center gap-3 text-sm rounded-lg px-3 py-2.5 transition-colors ${
                    f.free ? "hover:bg-accent/50" : "opacity-50"
                  }`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.08 }}
                >
                  {f.free ? (
                    <div className="rounded-full bg-primary/10 p-1">
                      <Check className="h-3.5 w-3.5 text-primary" />
                    </div>
                  ) : (
                    <div className="rounded-full bg-muted p-1">
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <span className="text-foreground">{t(f.key)}</span>
                  {typeof f.free === "string" && (
                    <span className="ms-auto text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {f.free}
                    </span>
                  )}
                </motion.div>
              ))}
            </CardContent>
          </MotionCard>

          {/* Pro Plan */}
          <MotionCard
            className={`relative overflow-hidden transition-shadow duration-300 hover:shadow-xl ${
              currentTier === "pro"
                ? "border-primary ring-2 ring-primary/30 shadow-lg"
                : "border-primary/40 shadow-md"
            }`}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {/* Popular badge */}
            {currentTier === "free" && (
              <motion.div
                className="absolute top-0 inset-x-0 flex justify-center"
                initial={{ y: -30 }}
                animate={{ y: 0 }}
                transition={{ delay: 0.6, type: "spring" }}
              >
                <span className="bg-primary text-primary-foreground text-xs font-semibold px-4 py-1 rounded-b-lg">
                  ⭐ {t("pricing.recommended") || "Recommended"}
                </span>
              </motion.div>
            )}

            {/* Gradient accent */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

            <CardHeader className="text-center pb-4 pt-10 relative">
              <motion.div
                className="flex justify-center mb-4"
                whileHover={{ rotate: -15, scale: 1.1 }}
                transition={{ type: "spring", stiffness: 300 }}
              >
                <div className="rounded-2xl bg-primary/15 p-4 relative">
                  <Crown className="h-8 w-8 text-primary" />
                  <motion.div
                    className="absolute -top-1 -right-1"
                    animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <Sparkles className="h-4 w-4 text-primary" />
                  </motion.div>
                </div>
              </motion.div>
              <CardTitle className="text-2xl">{t("pricing.pro_plan")}</CardTitle>
              <p className="text-4xl font-bold text-foreground mt-3">
                {t("pricing.pro_price")}
              </p>
              {currentTier === "pro" && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
                  <Badge className="mt-3 text-sm px-3 py-1">{t("pricing.current")}</Badge>
                </motion.div>
              )}
            </CardHeader>
            <CardContent className="space-y-1 pb-8 relative">
              {features.map((f, i) => (
                <motion.div
                  key={f.key}
                  className="flex items-center gap-3 text-sm rounded-lg px-3 py-2.5 hover:bg-accent/50 transition-colors"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.08 }}
                >
                  <div className="rounded-full bg-primary/15 p-1">
                    <Check className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="text-foreground font-medium">{t(f.key)}</span>
                  {typeof f.pro === "string" && (
                    <span className="ms-auto text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      {f.pro}
                    </span>
                  )}
                </motion.div>
              ))}

              {currentTier === "free" && (
                <motion.div
                  className="pt-6"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7 }}
                >
                  {upgradeRequested ? (
                    <Button disabled className="w-full h-12 text-base rounded-xl">
                      {t("pricing.request_pending")}
                    </Button>
                  ) : (
                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                      <Button
                        onClick={requestUpgrade}
                        disabled={requesting}
                        className="w-full h-12 text-base rounded-xl shadow-md hover:shadow-lg transition-shadow"
                      >
                        {requesting ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : <Crown className="h-4 w-4 me-2" />}
                        {t("pricing.request_upgrade")}
                      </Button>
                    </motion.div>
                  )}
                  <p className="text-xs text-muted-foreground text-center mt-3">
                    {t("pricing.admin_approval_note")}
                  </p>
                </motion.div>
              )}
            </CardContent>
          </MotionCard>
        </div>
      </div>
    </AppLayout>
  );
};

export default Pricing;
