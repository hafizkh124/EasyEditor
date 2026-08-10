import { useState } from "react";
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
import { Loader2 } from "lucide-react";
import { GoogleIcon } from "@/components/icons/GoogleIcon";

const Login = () => {
  useSeo({ title: "Log in — Al-Ulama Easy Editor", description: "Sign in to Al-Ulama Easy Editor to access transcription, OCR, TTS and Islamic research tools.", path: "/login", noindex: true });

  const { user, loading } = useAuth();
  const { t, direction } = useLanguage();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Preserve ?next= across auth so OAuth consent (and other deep links)
  // return the user to where they came from. Only accept same-origin
  // relative paths — never external URLs.
  const rawNext = searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null;

  if (loading) return null;
  if (user) return <Navigate to={next ?? "/dashboard"} replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message);
    setIsLoading(false);
  };

  const handleGoogle = async () => {
    const { error } = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + (next ?? ""),
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
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Log in to Easy Editor</h1>
          <p className="text-sm text-muted-foreground">{t("auth.login")}</p>
        </div>

        <Card className="border-border/60 shadow-lg">
          <CardContent className="pt-6 space-y-4">
            {/* Google */}
            <Button variant="outline" className="w-full h-11 gap-2 font-medium" onClick={handleGoogle}>
              <GoogleIcon className="h-4 w-4" />
              {t("auth.google")}
            </Button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t("auth.password")}</Label>
                  <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                    {t("auth.forgot_password")}
                  </Link>
                </div>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-11" />
              </div>
              <Button type="submit" className="w-full h-11" disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.login")}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center pb-6">
            <p className="text-sm text-muted-foreground">
              {t("auth.no_account")}{" "}
              <Link to="/signup" className="font-medium text-primary hover:underline">{t("auth.signup")}</Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export default Login;
