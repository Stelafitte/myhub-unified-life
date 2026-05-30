import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// TEST MODE: simulate a logged-in user so components work normally
const MOCK_USER: User = {
  id: "test-user-id",
  email: "test@example.com",
  user_metadata: { display_name: "Test User" },
  app_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
  role: "authenticated",
  updated_at: new Date().toISOString(),
  identities: [],
  factors: [],
} as unknown as User;

const MOCK_SESSION: Session = {
  access_token: "test-token",
  refresh_token: "test-refresh",
  expires_in: 3600,
  expires_at: Date.now() / 1000 + 3600,
  token_type: "bearer",
  user: MOCK_USER,
};

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
  const [session, setSession] = useState<Session | null>(MOCK_SESSION);
  const [loading, setLoading] = useState(false);

  const refreshSession = async () => {
    // In test mode just return the mock session
    return MOCK_SESSION;
  };

  useEffect(() => {
    // Keep real Supabase session in sync in background so OAuth still works
    // when we re-enable auth, but don't let it override our mock
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
      // During test mode we ignore the real session to keep user "logged in"
      // setSession(data.session);
      // setLoading(false);
    };

    syncSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!active) return;
      // During test mode we ignore real auth state changes
      // setSession(s);
      // setLoading(false);
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
