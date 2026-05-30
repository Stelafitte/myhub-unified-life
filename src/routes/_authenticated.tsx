import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { HdsNoticeDialog } from "@/components/security/hds-notice-dialog";
import { SecureVaultProvider } from "@/lib/secure-vault-context";
import { SessionExpiredBanner } from "@/components/session-expired-banner";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <SecureVaultProvider>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background">
          <AppSidebar />
          <div className="flex flex-1 flex-col">
            <AppHeader />
            <SessionExpiredBanner />
            <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">
              <div className="mx-auto w-full max-w-[1400px]">
                <Outlet />
              </div>
            </main>
            <HdsNoticeDialog />
          </div>
        </div>
      </SidebarProvider>
    </SecureVaultProvider>
  );
}
