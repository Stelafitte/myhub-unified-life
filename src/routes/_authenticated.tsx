import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { HdsNoticeDialog } from "@/components/security/hds-notice-dialog";
import { SecureVaultProvider } from "@/lib/secure-vault-context";

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
            <main className="flex-1 overflow-auto p-6">
              <Outlet />
            </main>
            <HdsNoticeDialog />
          </div>
        </div>
      </SidebarProvider>
    </SecureVaultProvider>
  );
}
