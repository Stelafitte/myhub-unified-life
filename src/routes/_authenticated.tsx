import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { HdsNoticeDialog } from "@/components/security/hds-notice-dialog";
import { SecureVaultProvider } from "@/lib/secure-vault-context";
import { TaskPanelProvider } from "@/lib/task-panel-context";
import { GlobalTaskPanel } from "@/components/tasks/global-task-panel";
import { SessionExpiredBanner } from "@/components/session-expired-banner";
import { supabase } from "@/integrations/supabase/client";

async function consumeOAuthTokensFromUrl() {
  if (typeof window === "undefined") return;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);
  const accessToken = hashParams.get("access_token") ?? searchParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token") ?? searchParams.get("refresh_token");
  const code = searchParams.get("code");

  if (accessToken && refreshToken) {
    await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }
  if (code) {
    await supabase.auth.exchangeCodeForSession(code).catch(() => null);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;

    // 1) Si on revient d'un OAuth callback avec des tokens dans l'URL,
    //    on les consomme AVANT de tester la session — sinon getSession()
    //    renvoie null et on est redirigé vers /login alors qu'on vient
    //    juste de se connecter.
    await consumeOAuthTokensFromUrl();

    // 2) getSession() déclenche l'initialisation interne du client Supabase
    //    (lecture du localStorage), donc on est sûr d'avoir la session si
    //    elle existe.
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }

    // 3) Onboarding gate : forcer /onboarding tant que profiles.onboarding_completed_at
    //    est null — SAUF si l'utilisateur a déjà au moins un compte configuré
    //    (cas d'un utilisateur existant qui se reconnecte : on auto-complète).
    if (!location.pathname.startsWith("/onboarding")) {
      const userId = data.session.user.id;
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed_at")
        .eq("id", userId)
        .maybeSingle();
      if (!profile?.onboarding_completed_at) {
        const { count } = await supabase
          .from("accounts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        if ((count ?? 0) > 0) {
          // Utilisateur existant — on marque l'onboarding comme terminé et on laisse passer.
          await supabase
            .from("profiles")
            .update({ onboarding_completed_at: new Date().toISOString() })
            .eq("id", userId);
        } else {
          throw redirect({ to: "/onboarding", replace: true });
        }
      }
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const location = useLocation();
  const isInbox = location.pathname.endsWith("/inbox");

  return (
    <SecureVaultProvider>
      <TaskPanelProvider>
        <SidebarProvider>
          <div className="flex min-h-screen w-full overflow-x-hidden bg-background">
            <AppSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <AppHeader />
              <SessionExpiredBanner />
              <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-scroll p-3 [scrollbar-gutter:stable] sm:p-4 md:p-6">
                <div className={isInbox ? "w-full min-w-0" : "mx-auto w-full max-w-[1400px] min-w-0"}>
                  <Outlet />
                </div>
              </main>
              <HdsNoticeDialog />
            </div>
          </div>
          <GlobalTaskPanel />
        </SidebarProvider>
      </TaskPanelProvider>
    </SecureVaultProvider>
  );
}
