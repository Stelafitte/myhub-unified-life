// MyHub Pro v1.0
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { LayoutDashboard, Inbox, CheckSquare, Calendar, Users, ClipboardList, Settings, Lock, CalendarClock, FolderOpen, BarChart3, Shield, Handshake, MessageCircle } from "lucide-react";
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
import { useNavOrder } from "@/lib/use-nav-order";

const baseItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Inbox", url: "/inbox", icon: Inbox },
  { title: "Coffre sécurisé", url: "/secure-box", icon: Lock },
  { title: "Tâches et Actions", url: "/tasks", icon: CheckSquare },
  { title: "Agenda", url: "/calendar", icon: Calendar },
  { title: "Réunions", url: "/meetings", icon: CalendarClock },
  { title: "Documents", url: "/documents", icon: FolderOpen },
  { title: "Contacts", url: "/contacts", icon: Users },
  { title: "Collaboratif", url: "/collaborate", icon: Handshake },
  { title: "Plan d'opération", url: "/plan-operation", icon: ClipboardList },
  { title: "Stats", url: "/stats", icon: BarChart3 },
] as const;

const DEFAULT_ORDER = baseItems.map((i) => i.url);

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { isAdmin } = useIsAdmin();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const { order } = useNavOrder(DEFAULT_ORDER);
  const closeIfMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  // Ferme automatiquement la sidebar mobile lors d'un changement de route
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isMobile]);
  const orderedBase = order
    .map((url) => baseItems.find((i) => i.url === url))
    .filter((i): i is (typeof baseItems)[number] => Boolean(i));
  const items = [
    ...orderedBase,
    { title: "Paramètres", url: "/settings", icon: Settings } as const,
    ...(isAdmin ? [{ title: "Administration", url: "/admin", icon: Shield } as const] : []),
  ];



  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={cn("border-b py-3", collapsed ? "px-2" : "px-4")}>
        <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            M
          </div>
          {!collapsed && <span className="font-semibold text-sm">MyHub Pro</span>}
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
                    <Link to={item.url} onClick={closeIfMobile}>
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
