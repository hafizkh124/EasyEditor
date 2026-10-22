import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Gift, Share2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFormatDate } from "@/lib/formatDate";
import { buildReferralLink } from "@/lib/referral";

interface ReferralEvent {
  id: string;
  referee_id: string;
  credits_granted: number;
  granted_at: string;
  referee_name?: string | null;
}

const ReferralCard = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const formatDate = useFormatDate();
  const [code, setCode] = useState<string | null>(null);
  const [credits, setCredits] = useState(0);
  const [events, setEvents] = useState<ReferralEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("referral_code, referral_credits")
        .eq("user_id", user.id)
        .single();
      const p = profile as { referral_code?: string | null; referral_credits?: number | null } | null;
      setCode(p?.referral_code ?? null);
      setCredits(p?.referral_credits ?? 0);

      const { data: evs } = await supabase
        .from("referral_events")
        .select("id, referee_id, credits_granted, granted_at")
        .eq("referrer_id", user.id)
        .order("granted_at", { ascending: false })
        .limit(20);
      const evList = (evs ?? []) as ReferralEvent[];

      // Fetch referee display names in one shot.
      if (evList.length > 0) {
        const refereeIds = Array.from(new Set(evList.map((e) => e.referee_id)));
        const { data: refereeProfiles } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", refereeIds);
        const nameMap = new Map<string, string | null>(
          (refereeProfiles ?? []).map((rp) => [rp.user_id, rp.display_name]),
        );
        setEvents(evList.map((e) => ({ ...e, referee_name: nameMap.get(e.referee_id) ?? null })));
      } else {
        setEvents([]);
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const referralLink = code ? buildReferralLink(code) : null;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("referral.copied", "Copied!"));
    } catch {
      toast.error(t("referral.copy_failed", "Could not copy"));
    }
  };

  const shareLink = async () => {
    if (!referralLink) return;
    const shareData = {
      title: t("referral.share_title", "Join Al-Ulama Easy Editor"),
      text: t("referral.share_text", "Try Al-Ulama Easy Editor — AI tools for Urdu, Arabic, and English."),
      url: referralLink,
    };
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share(shareData);
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    copy(referralLink);
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
          <Gift className="h-5 w-5 text-primary" />
          {t("referral.title", "Refer Friends, Earn Credits")}
        </CardTitle>
        <CardDescription>
          {t("referral.subtitle", "Share your code. When someone signs up and is approved, you earn credits.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">{t("referral.your_code", "Your code")}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-base font-semibold">{code ?? "—"}</span>
              {code && (
                <Button size="icon" variant="ghost" className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0" onClick={() => copy(code)} aria-label="Copy referral code">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="rounded-md border border-border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">{t("referral.credits_balance", "Credits earned")}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-semibold">{credits.toLocaleString()}</span>
              <Badge variant="secondary" className="text-xs">
                {t("referral.redeemable_soon", "Redeemable soon")}
              </Badge>
            </div>
          </div>
        </div>

        {referralLink && (
          <div className="rounded-md border border-border p-3 space-y-2">
            <p className="text-xs text-muted-foreground">{t("referral.shareable_link", "Shareable link")}</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={referralLink}
                aria-label={t("referral.link_input", "Your referral link")}
                className="flex-1 bg-transparent text-xs font-mono border-b border-border min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button size="sm" variant="outline" onClick={() => copy(referralLink)}>
                <Copy className="h-3.5 w-3.5 me-1" />
                {t("referral.copy", "Copy")}
              </Button>
              <Button size="sm" onClick={shareLink}>
                <Share2 className="h-3.5 w-3.5 me-1" />
                {t("referral.share", "Share")}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("referral.history", "Referral history")}
          </p>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              {t("referral.history_empty", "No referrals yet. Share your link to start earning!")}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {events.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{e.referee_name || t("referral.anonymous_friend")}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(e.granted_at, "date")}
                    </p>
                  </div>
                  <Badge variant="default">+{e.credits_granted}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground italic">
          {t("referral.disclaimer", "Credits will be redeemable for subscription discounts in a future update.")}
        </p>
      </CardContent>
    </Card>
  );
};

export default ReferralCard;
