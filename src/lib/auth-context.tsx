import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  refreshSession: () => Promise<Session | null>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  refreshSession: async () => null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const explicitSignOut = useRef(false);

  const refreshSession = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) setSession(data.session);
    return data.session;
  };

  useEffect(() => {
    let active = true;

    const cleanOAuthUrl = () => {
      window.history.replaceState({}, document.title, window.location.pathname || "/");
    };

    const restoreOAuthCallbackSession = async () => {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const searchParams = new URLSearchParams(window.location.search);
      const accessToken = hashParams.get("access_token") ?? searchParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token") ?? searchParams.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error) cleanOAuthUrl();
        return;
      }

      const code = searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) cleanOAuthUrl();
      }
    };

    const syncSession = async () => {
      await restoreOAuthCallbackSession();
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      // Ne pas effacer la session si le refresh a échoué (expiration suspendue)
      if (data.session) setSession(data.session);
      setLoading(false);
    };

    syncSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!active) return;
      // Suspendre la déconnexion automatique par expiration de session
      if (event === "SIGNED_OUT" && !explicitSignOut.current) {
        // On ignore la perte de session imposée par expiration / refresh token invalide
        return;
      }
      explicitSignOut.current = false;
      setSession(s);
      setLoading(false);
    });

    window.addEventListener("focus", syncSession);
    window.addEventListener("pageshow", syncSession);

    return () => {
      active = false;
      window.removeEventListener("focus", syncSession);
      window.removeEventListener("pageshow", syncSession);
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        refreshSession,
        signOut: async () => {
          explicitSignOut.current = true;
          await supabase.auth.signOut();
          setSession(null);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
