import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, User, LayoutDashboard, ChevronDown, Loader2, LogOut, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  CONNECT_DEVICE_URL, createDeviceLinkCode, pollDeviceLinkStatus, completeDeviceLinkSignIn,
} from "@/lib/desktopDeviceLink";
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
import { GoogleIcon } from "@/components/icons/GoogleIcon";

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

const POLL_INTERVAL_MS = 2500;

/**
 * Desktop can't use the project's Google OAuth provider directly — see
 * `src/lib/desktopDeviceLink.ts`'s header for the full story. This shows the
 * device code and polls until the user confirms it on the (already-working)
 * web sign-in page, then completes the session here.
 */
const GoogleDeviceLinkWait: React.FC<{
  code: string;
  expiresAt: string;
  onDone: () => void;
  onCancel: () => void;
}> = ({ code, expiresAt, onDone, onCancel }) => {
  const { t } = useLanguage();
  const [expired, setExpired] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const expiresAtMs = new Date(expiresAt).getTime();

    const tick = async () => {
      if (cancelledRef.current) return;
      if (Date.now() >= expiresAtMs) {
        setExpired(true);
        return;
      }
      const result = await pollDeviceLinkStatus(code);
      if (cancelledRef.current) return;
      if ("error" in result) return; // transient — the next tick retries
      if (result.status === "expired" || result.status === "not_found") {
        setExpired(true);
        return;
      }
      // "claimed" with no token here means the one-time hand-off already
      // happened (or failed) on a previous poll — this code can never make
      // progress again, so stop waiting on it the same as an expired one.
      if (result.status === "claimed") {
        setExpired(true);
        return;
      }
      if (result.status === "confirmed" && result.email && result.tokenHash) {
        const { error } = await completeDeviceLinkSignIn(result.email, result.tokenHash);
        if (cancelledRef.current) return;
        if (error) {
          toast.error(t("device_link.error_sign_in_failed"));
          setExpired(true);
          return;
        }
        onDone();
        return;
      }
      timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    };

    let timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- code/expiresAt are stable for this component's lifetime (a fresh code = a fresh mount via `key`)
  }, []);

  if (expired) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">{t("device_link.expired")}</p>
        <Button variant="outline" className="w-full" onClick={onCancel}>{t("common.retry")}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-center">
      <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
      <p className="text-sm font-medium text-foreground">{t("device_link.waiting_title")}</p>
      <p className="text-xs text-muted-foreground">
        {t("device_link.waiting_desc").replace("{url}", CONNECT_DEVICE_URL)}
      </p>
      <p className="font-mono text-lg tracking-widest text-foreground" dir="ltr">{code}</p>
      <p className="text-xs text-muted-foreground">{t("device_link.code_label")}</p>
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={onCancel}>
        <X className="h-3.5 w-3.5" />
        {t("common.cancel")}
      </Button>
    </div>
  );
};

const SignInForm: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { t, direction } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busyMode, setBusyMode] = useState<SignInMode>(null);
  const [deviceLink, setDeviceLink] = useState<{ code: string; expiresAt: string } | null>(null);

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
    // This component only ever renders on desktop (the parent bails out with
    // `if (!isDesktop()) return null`) — the project's Google OAuth provider
    // only works through Lovable's managed web broker, unreachable from a
    // file://-loaded renderer, so desktop signs in via a device-link code
    // confirmed on the (already-working) web page instead. See
    // src/lib/desktopDeviceLink.ts.
    const result = await createDeviceLinkCode();
    setBusyMode(null);
    if ("error" in result) {
      toast.error(t("device_link.error_create_failed"));
      return;
    }
    const opened = await window.electronAPI?.openExternal(`${CONNECT_DEVICE_URL}?code=${result.code}`);
    if (!opened) toast.error(t("device_link.error_open_failed"));
    setDeviceLink(result);
  };

  if (deviceLink) {
    return (
      <GoogleDeviceLinkWait
        key={deviceLink.code}
        code={deviceLink.code}
        expiresAt={deviceLink.expiresAt}
        onDone={() => {
          toast.success(t("auth.login_success"));
          onDone();
        }}
        onCancel={() => setDeviceLink(null)}
      />
    );
  }

  return (
    <div dir={direction} className="space-y-4">
      <Button variant="outline" className="w-full h-11 gap-2 font-medium" onClick={handleGoogle} disabled={busyMode !== null}>
        {busyMode === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <GoogleIcon className="h-4 w-4" />
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

export const SignInDialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void }> = ({ open, onOpenChange }) => {
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
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal truncate">
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
