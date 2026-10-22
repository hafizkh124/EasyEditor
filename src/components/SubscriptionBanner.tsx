import { Link } from "react-router-dom";
import { AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useApproval } from "@/hooks/useApproval";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Top-of-page banner that warns users when their subscription has expired.
 * - In the 7-day grace period: amber warning with countdown, access still works.
 * - After grace: red banner; ProtectedRoute also redirects to /pricing?expired=true.
 * Admins are exempt (never see this banner).
 */
export default function SubscriptionBanner() {
  const { isExpired, isLapsed, daysUntilLapse } = useSubscription();
  const { isAdmin } = useApproval();
  const { language } = useLanguage();
  const ur = language === "ur";

  if (isAdmin || !isExpired) return null;

  if (isLapsed) {
    return (
      <div className="w-full bg-destructive-soft border-b border-destructive-border px-4 py-2.5 text-sm text-destructive">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium">
              {ur
                ? "آپ کی سبسکرپشن ختم ہو گئی ہے۔ تمام فیچرز بند ہیں — برائے کرم renew کریں۔"
                : "Your subscription has lapsed. All features are locked — please renew to continue."}
            </span>
          </div>
          <Button asChild size="sm" variant="destructive" className="self-start sm:self-auto">
            <Link to="/pricing?expired=true">{ur ? "ابھی renew کریں" : "Renew now"}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-warning-soft border-b border-warning-border px-4 py-2.5 text-sm text-warning">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="font-medium">
            {ur
              ? `آپ کی سبسکرپشن ختم ہو چکی ہے۔ ${daysUntilLapse ?? 0} دن میں access بند ہو جائے گا۔`
              : `Your subscription has expired. Access will lock in ${daysUntilLapse ?? 0} day${daysUntilLapse === 1 ? "" : "s"}.`}
          </span>
        </div>
        <Button asChild size="sm" className="self-start sm:self-auto">
          <Link to="/pricing?expired=true">{ur ? "ابھی renew کریں" : "Renew now"}</Link>
        </Button>
      </div>
    </div>
  );
}
