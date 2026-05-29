import { useEffect } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useSeo } from "@/hooks/useSeo";

const CheckoutSuccess = () => {
  useSeo({ title: "Payment successful — Easy Editor", description: "Your payment was received successfully. Your Easy Editor account is being activated — this usually takes just a few seconds.", path: "/checkout/success" });
  const { refetch } = useSubscription();

  // Poll for the webhook-driven update so the user sees their new tier quickly.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      await refetch();
      attempts++;
      if (attempts < 8) setTimeout(tick, 1500);
    };
    tick();
    return () => { cancelled = true; };
  }, [refetch]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardContent className="pt-8 pb-6 text-center space-y-4">
          <div className="mx-auto rounded-full bg-emerald-500/10 p-4 w-fit">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Payment successful</h1>
          <p className="text-muted-foreground text-sm">
            Thank you! Your account is being activated. This may take a few seconds.
          </p>
          <div className="flex gap-2 justify-center pt-2">
            <Button asChild>
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/settings">View Plan</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CheckoutSuccess;
