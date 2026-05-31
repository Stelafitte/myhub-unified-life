import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Inbox,
  CheckSquare,
  Calendar,
  Users,
  ClipboardList,
  Settings,
  Lock,
  CalendarClock,
  FolderOpen,
  BarChart3,
  Shield,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsAdmin } from "@/lib/use-role";
import { cn } from "@/lib/utils";

const baseItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Inbox", url: "/inbox", icon: Inbox },
  { title: "Coffre sécurisé", url: "/secure-box", icon: Lock },
  { title: "Tâches", url: "/tasks", icon: CheckSquare },
  { title: "Agenda", url: "/calendar", icon: Calendar },
  { title: "Réunions", url: "/meetings", icon: CalendarClock },
  { title: "Documents", url: "/documents", icon: FolderOpen },
  { title: "Contacts", url: "/contacts", icon: Users },
  { title: "Plan d'opération", url: "/plan-operation", icon: ClipboardList },
  { title: "Stats", url: "/stats", icon: BarChart3 },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { isAdmin } = useIsAdmin();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const closeIfMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  // Ferme automatiquement la sidebar mobile lors d'un changement de route
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isMobile]);
  const items = [
    ...baseItems,
    { title: "Paramètres", url: "/settings", icon: Settings } as const,
    ...(isAdmin ? [{ title: "Administration", url: "/admin", icon: Shield } as const] : []),
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={cn("border-b py-4", collapsed ? "px-2" : "px-4")}>
        <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-base font-bold text-primary-foreground">
            M
          </div>
          {!collapsed && <span className="text-base font-semibold">MyHub Pro</span>}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sm">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url}
                    tooltip={item.title}
                    className="h-11 text-base"
                  >
                    <Link to={item.url} onClick={closeIfMobile}>
                      <item.icon className="h-5 w-5" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
