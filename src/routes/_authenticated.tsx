import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { HdsNoticeDialog } from "@/components/security/hds-notice-dialog";
import { SecureVaultProvider } from "@/lib/secure-vault-context";
import { TaskPanelProvider } from "@/lib/task-panel-context";
import { GlobalTaskPanel } from "@/components/tasks/global-task-panel";
import { SessionExpiredBanner } from "@/components/session-expired-banner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <SecureVaultProvider>
      <TaskPanelProvider>
        <SidebarProvider>
          <div className="flex min-h-screen w-full overflow-x-hidden bg-background">
            <AppSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <AppHeader />
              <SessionExpiredBanner />
              <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4 md:p-6">
                <div className="mx-auto w-full max-w-[1400px] min-w-0">
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
