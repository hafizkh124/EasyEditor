import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, User, LayoutDashboard, ChevronDown, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { startDesktopOauth } from "@/lib/desktopOauth";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { isDesktop } from "@/utils/environment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The desktop build is fully offline and does not require an account. Signing
 * in is an OPTIONAL, opt-in action for users who also have a cloud account.
 * This compact affordance lives inside the app (workspace top bar / app layout)
 * instead of forcing the app to start on a public sign-in page.
 *
 * It only renders inside Electron desktop mode; the web build keeps its own
 * public marketing/auth pages.
 *
 * Note that signing in must never take the offline app away: ProtectedRoute
 * keeps `allowGuest` routes reachable regardless of session or approval state.
 */

type SignInMode = "password" | "google" | null;

const SignInForm: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { t, direction } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busyMode, setBusyMode] = useState<SignInMode>(null);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyMode("password");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusyMode(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("auth.login_success"));
    onDone();
  };

  const handleGoogle = async () => {
    setBusyMode("google");
    // Desktop cannot use the shared `lovable` helper: it redirects the current
    // window, which Electron's navigation guard intercepts. See desktopOauth.ts.
    const { error } = isDesktop()
      ? await startDesktopOauth("google")
      : await lovable.auth.signInWithOAuth("google", {
          redirect_uri: window.location.origin + "/login",
        });
    setBusyMode(null);
    if (error) toast.error(error.message);
  };

  return (
    <div dir={direction} className="space-y-4">
      <Button variant="outline" className="w-full h-11 gap-2 font-medium" onClick={handleGoogle} disabled={busyMode !== null}>
        {busyMode === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
        )}
        {busyMode === "google" ? t("auth.signing_in") : t("auth.google")}
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">{t("auth.or")}</span>
        </div>
      </div>

      <form onSubmit={handleEmail} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="d-sk-email">{t("auth.email")}</Label>
          <Input id="d-sk-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-sk-password">{t("auth.password")}</Label>
          <Input id="d-sk-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-11" />
        </div>
        <Button type="submit" className="w-full h-11" disabled={busyMode !== null}>
          {busyMode === "password" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {busyMode === "password" ? t("auth.signing_in") : t("auth.login")}
        </Button>
      </form>
    </div>
  );
};

const SignInDialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void }> = ({ open, onOpenChange }) => {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-4 w-4 text-primary" />
            {t("auth.login_title")}
          </DialogTitle>
          <DialogDescription>
            {t("auth.login_desc")}
          </DialogDescription>
        </DialogHeader>
        <SignInForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
};

const SignInTrigger: React.FC = () => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs shrink-0"
        onClick={() => setOpen(true)}
        aria-label={t("auth.sign_in_optional")}
      >
        <LogIn className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("auth.sign_in_optional")}</span>
      </Button>
      <SignInDialog open={open} onOpenChange={setOpen} />
    </>
  );
};

export const DesktopAccountMenu: React.FC = () => {
  const { user, signOut } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  if (!isDesktop()) return null;

  if (!user) return <SignInTrigger />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs shrink-0" aria-label={t("nav.account")} title={t("nav.account")}>
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline max-w-[10rem] truncate text-muted-foreground">{user.email}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal truncate">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/dashboard")} className="cursor-pointer gap-2">
          <LayoutDashboard className="h-4 w-4 text-primary" />
          {t("nav.dashboard")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            await signOut();
            toast.success(t("auth.signed_out"));
          }}
          className="cursor-pointer gap-2 text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          {t("auth.sign_out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
