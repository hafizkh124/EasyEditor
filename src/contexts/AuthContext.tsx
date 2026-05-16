import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { applyPendingReferral, consumePendingReferralCode } from "@/lib/referral";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let initialSessionHandled = false;

    /** Remove Supabase auth hash fragments (access_token=…) or a bare trailing '#' */
    const cleanupHashFragment = () => {
      if (typeof window === "undefined") return;
      const hash = window.location.hash;
      if (hash.includes("access_token") || hash === "#") {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        if (import.meta.env.DEV) console.log("[Auth] Hash fragment detected and cleaned safely.");
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      // Only clear loading if getSession already resolved (avoids flicker)
      if (initialSessionHandled) {
        setLoading(false);
      }

      // Clean up after OAuth / magic-link sign-in or token refresh
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        cleanupHashFragment();
      }

      // Apply any pending referral code stashed by Signup.tsx before an
      // OAuth redirect or email-confirmation round-trip. Fire-and-forget;
      // failures are non-fatal.
      if (event === "SIGNED_IN" && session?.user?.id) {
        const code = consumePendingReferralCode();
        if (code) {
          applyPendingReferral(session.user.id, code, supabase as Parameters<typeof applyPendingReferral>[2]).catch(() => {
            /* non-fatal */
          });
        }
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      initialSessionHandled = true;
      setLoading(false);

      // Clean up any residual hash fragment from a prior auth redirect
      if (session) {
        cleanupHashFragment();
      }
    }).catch(() => {
      initialSessionHandled = true;
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
