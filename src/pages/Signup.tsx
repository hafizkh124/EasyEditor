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
                ? (t("signup.referred_by_named") || "Referred by {name}").replace("{name}", referrerName)
                : (t("signup.referred_with_code") || "Joining with referral code {code}").replace("{code}", referralCode)}
            </span>
          </div>
        )}

        <Card className="border-border/60 shadow-lg">
          <CardContent className="pt-6 space-y-4">
            <Button variant="outline" className="w-full h-11 gap-2 font-medium" onClick={handleGoogle}>
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
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
