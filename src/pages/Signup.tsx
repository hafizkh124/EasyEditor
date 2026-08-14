import { useEffect, useState } from "react";
import { useSeo } from "@/hooks/useSeo";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Gift } from "lucide-react";
import { REFERRAL_PARAM, stashPendingReferralCode, applyPendingReferral, consumePendingReferralCode } from "@/lib/referral";
import { GoogleIcon } from "@/components/icons/GoogleIcon";

const Signup = () => {
  useSeo({ title: "Sign up — Al-Ulama Easy Editor", description: "Create your Al-Ulama Easy Editor account to use AI transcription, OCR, TTS and grounded research.", path: "/signup", noindex: true });

  const { user, loading } = useAuth();
  const { t, direction } = useLanguage();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [referrerName, setReferrerName] = useState<string | null>(null);

  // Persist referral code across the OAuth redirect: stash it in localStorage
  // when present in the URL. AuthContext picks it up on SIGNED_IN.
  const referralCode = searchParams.get(REFERRAL_PARAM)?.trim() || null;
  useEffect(() => {
    if (referralCode) {
      stashPendingReferralCode(referralCode);
      supabase
        .from("profiles")
        .select("display_name")
        .eq("referral_code", referralCode)
        .single()
        .then(({ data }) => {
          if (data?.display_name) setReferrerName(data.display_name);
        });
    }
  }, [referralCode]);

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      toast.error(error.message);
    } else {
      // If the profile already exists (no email confirmation required), apply
      // the referral immediately. Otherwise it will be applied by AuthContext
      // on SIGNED_IN after the user confirms their email.
      if (referralCode && data.user?.id) {
        try {
          await applyPendingReferral(data.user.id, referralCode, supabase);
          consumePendingReferralCode();
        } catch {
          /* will retry on SIGNED_IN */
        }
      }
      toast.success("Check your email for a confirmation link!");
    }
    setIsLoading(false);
  };

  const handleGoogle = async () => {
    // Referral code is stashed in sessionStorage by the effect above; the
    // post-OAuth landing handler will pick it up and call applyReferral.
    const { error } = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (error) toast.error(error.message);
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4"
      dir={direction}
    >
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="rounded-2xl bg-primary/10 p-3">
            <img src="/favicon.webp" alt="Easy Editor" width={40} height={40} className="rounded-lg" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Sign up for Easy Editor</h1>
          <p className="text-sm text-muted-foreground">{t("auth.signup")}</p>
        </div>

        {referralCode && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 flex items-center gap-2 text-sm">
            <Gift className="h-4 w-4 text-green-600 flex-shrink-0" />
            <span className="text-foreground">
              {referrerName
                ? (t("signup.referred_by_named", "Referred by {name}")).replace("{name}", referrerName)
                : (t("signup.referred_with_code", "Joining with referral code {code}")).replace("{code}", referralCode)}
            </span>
          </div>
        )}

        <Card className="border-border/60 shadow-lg">
          <CardContent className="pt-6 space-y-4">
            <Button variant="outline" className="w-full h-11 gap-2 font-medium" onClick={handleGoogle}>
              <GoogleIcon className="h-4 w-4" />
              {t("auth.google")}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="h-11" />
              </div>
              <Button type="submit" className="w-full h-11" disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.signup")}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center pb-6">
            <p className="text-sm text-muted-foreground">
              {t("auth.have_account")}{" "}
              <Link to="/login" className="font-medium text-primary hover:underline">{t("auth.login")}</Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export default Signup;
