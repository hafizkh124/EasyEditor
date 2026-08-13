import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Clock, Construction, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { priceForCurrency, type PaidTier, type PlanTier } from "@/lib/planTiers";
import type { Translator, TranslationKey } from "@/lib/i18n";

const MotionCard = motion(Card);

export interface PlanFeature {
  label: string;
  included: boolean;
  comingSoon?: boolean;
}

/**
 * A tier's shared data joined with the presentation this page gives it.
 * Extends `PlanTier` rather than restating its fields, so `priceForCurrency`
 * and friends keep working and a change to the shared shape is caught here.
 */
export type PricingPlan = PlanTier & {
  features: PlanFeature[];
  icon: LucideIcon;
  iconClass: string;
  bgClass: string;
  cardBorder: string;
  gradient: string;
};

interface PlanCardProps {
  plan: PricingPlan;
  index: number;
  isCurrent: boolean;
  isBelowCurrent: boolean;
  isPending: boolean;
  /** Above the current tier, nothing pending, and not a coming-soon tier. */
  showRequest: boolean;
  currency: "PKR" | "USD";
  language: string;
  t: Translator;
  onRequest: (plan: PaidTier) => void;
}

export const PlanCard = ({
  plan, index, isCurrent, isBelowCurrent, isPending, showRequest,
  currency, language, t, onRequest,
}: PlanCardProps) => {
  const Icon = plan.icon;
  const name = t(plan.nameKey as TranslationKey);

  return (
    <MotionCard
      className={`relative overflow-hidden transition-shadow duration-300 hover:shadow-lg ${
        isCurrent ? "border-primary ring-2 ring-primary/30 shadow-lg" : plan.cardBorder
      } ${isBelowCurrent ? "opacity-50" : ""}`}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: isBelowCurrent ? 0.5 : 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 + index * 0.1 }}
    >
      {plan.popular && !isCurrent && !isBelowCurrent && (
        <Ribbon delay={0.5}>
          <span className="bg-primary text-primary-foreground text-xs font-semibold px-4 py-1 rounded-b-lg">
            ⭐ {t("pricing.recommended")}
          </span>
        </Ribbon>
      )}

      {plan.comingSoon && (
        <Ribbon delay={0.5}>
          <span className="flex items-center gap-1.5 bg-amber-500 text-white text-xs font-semibold px-4 py-1 rounded-b-lg">
            <Construction className="h-3 w-3" />
            {t("pricing.coming_soon")}
          </span>
        </Ribbon>
      )}

      <div className={`absolute inset-0 bg-gradient-to-br ${plan.gradient} pointer-events-none`} />

      <CardHeader className={`text-center pb-4 relative ${plan.popular ? "pt-10" : "pt-8"}`}>
        <motion.div
          className="flex justify-center mb-3"
          whileHover={{ rotate: plan.id === "pro" ? -15 : 15, scale: 1.1 }}
          transition={{ type: "spring", stiffness: 300 }}
        >
          <div className={`rounded-2xl ${plan.bgClass} p-4`}>
            <Icon className={`h-7 w-7 ${plan.iconClass}`} />
          </div>
        </motion.div>

        <CardTitle className="text-xl">{name}</CardTitle>
        <div className="mt-2 space-y-1">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-3xl font-bold text-primary">{priceForCurrency(plan, currency)}</span>
            <span className="text-sm text-muted-foreground">/ {t("pricing.per_month")}</span>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Sparkles className="h-3 w-3" />
            {t("pricing.instant_verification", language === "ur" ? "سسٹم سے فوری تصدیق" : "Instant system verification")}
          </div>
        </div>

        {isCurrent && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
            <Badge className="mt-2 text-xs px-3 py-1">{t("pricing.current")}</Badge>
          </motion.div>
        )}
      </CardHeader>

      <CardContent className="space-y-0.5 pb-8 relative">
        {plan.features.map((feature, i) => (
          <FeatureRow key={feature.label} feature={feature} index={i} plan={plan} t={t} />
        ))}

        <motion.div
          className="pt-5"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          {plan.comingSoon ? (
            <Button disabled className="w-full h-11 rounded-xl" variant="outline">
              <Construction className="h-4 w-4 me-2 text-amber-500" />
              {t("pricing.notify_me")}
            </Button>
          ) : isPending ? (
            <div className="rounded-xl border border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-medium">
                <Clock className="h-4 w-4" />
                {t("pricing.pending_approval")}
              </div>
              <p className="text-xs text-muted-foreground">{t("pricing.pending_approval_desc")}</p>
            </div>
          ) : showRequest ? (
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button onClick={() => onRequest(plan.id)} className="w-full h-11 rounded-xl">
                <Icon className="h-4 w-4 me-2" />
                {language === "ur" ? `${name} حاصل کریں` : `Get ${name}`}
              </Button>
            </motion.div>
          ) : null}
        </motion.div>
      </CardContent>
    </MotionCard>
  );
};

const Ribbon = ({ children, delay }: { children: React.ReactNode; delay: number }) => (
  <motion.div
    className="absolute top-0 inset-x-0 flex justify-center"
    initial={{ y: -30 }}
    animate={{ y: 0 }}
    transition={{ delay, type: "spring" }}
  >
    {children}
  </motion.div>
);

const FeatureRow = ({
  feature, index, plan, t,
}: {
  feature: PlanFeature;
  index: number;
  plan: PricingPlan;
  t: Translator;
}) => (
  <motion.div
    className={`flex items-center gap-2.5 text-sm rounded-lg px-2.5 py-2 transition-colors ${
      feature.included ? "hover:bg-accent/50" : feature.comingSoon ? "" : "opacity-50"
    }`}
    initial={{ opacity: 0, x: -15 }}
    animate={{ opacity: feature.included || feature.comingSoon ? 1 : 0.5, x: 0 }}
    transition={{ delay: 0.25 + index * 0.06 }}
  >
    <div className={`rounded-full p-1 flex-shrink-0 ${feature.included ? plan.bgClass : "bg-muted"}`}>
      {feature.included ? (
        <Check className={`h-3 w-3 ${plan.iconClass}`} />
      ) : feature.comingSoon ? (
        <Clock className="h-3 w-3 text-amber-500" />
      ) : (
        <X className="h-3 w-3 text-muted-foreground" />
      )}
    </div>
    <span
      className={
        feature.included
          ? "text-foreground font-medium"
          : feature.comingSoon
            ? "text-foreground/80"
            : "text-muted-foreground line-through"
      }
    >
      {feature.label}
    </span>
    {feature.comingSoon && (
      <Badge variant="outline" className="ms-auto text-xs py-0 px-1.5 border-amber-400/60 text-amber-700 dark:text-amber-400">
        {t("pricing.coming_soon")}
      </Badge>
    )}
  </motion.div>
);
