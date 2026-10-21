import { useEffect } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";

const CheckoutSuccess = () => {
  useSeo({
    title: "Payment received — Easy Editor",
    description: "Your payment was received. Your Easy Editor account is being activated.",
    path: "/checkout/success",
  });
  const { t } = useLanguage();
  const { refetch } = useSubscription();

  useEffect(() => {
    refetch();
  }, [refetch]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardContent className="pt-8 pb-6 text-center space-y-4">
          <div className="mx-auto rounded-full bg-success/10 p-4 w-fit">
            <CheckCircle2 className="h-10 w-10 text-success" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t("checkout.payment_received")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("checkout.thank_you")}
          </p>
          <div className="flex gap-2 justify-center pt-2">
            <Button asChild>
              <Link to="/dashboard">{t("nav.dashboard")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/settings">{t("checkout.view_plan")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CheckoutSuccess;
