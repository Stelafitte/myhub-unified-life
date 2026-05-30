import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Inbox, CheckSquare, Calendar, Users, ClipboardList, Settings, Lock, CalendarClock, FolderOpen, BarChart3, Shield } from "lucide-react";
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
} from "@/components/ui/sidebar";
import { useIsAdmin } from "@/lib/use-role";

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
  const items = [
    ...baseItems,
    { title: "Paramètres", url: "/settings", icon: Settings } as const,
    ...(isAdmin ? [{ title: "Administration", url: "/admin", icon: Shield } as const] : []),
  ];


  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            M
          </div>
          <span className="font-semibold text-sm">MyHub Pro</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={pathname === item.url} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
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
