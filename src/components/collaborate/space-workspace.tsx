import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PanelRightClose, PanelRightOpen, Hash, Link2, FileText, CheckSquare, CalendarClock, Vote, Paperclip, Menu, Info } from "lucide-react";
import { SpaceTree } from "./space-tree";
import { SpaceChat } from "./space-chat";
import { SpaceLinksTab } from "./space-links-tab";
import { SpaceTasksTab } from "./space-tasks-tab";
import { SpaceMeetingsTab } from "./space-meetings-tab";
import { DocumentsTab } from "./documents-tab";
import { SpaceFilesTab } from "./space-files-tab";
import { SpacePollsTab } from "./space-polls-tab";
import { SpaceShareButton } from "./space-share-button";
import { CollabDashboard } from "./collab-dashboard";
import { GroupFormDialog } from "@/components/contacts/group-form-dialog";
import { getSpaceTree, getSpaceActivity } from "@/lib/collab.functions";
import { useAuth } from "@/lib/auth-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

const COMING_SOON = (
  <div className="p-8 text-center text-sm text-muted-foreground">
    Cette section arrive dans une prochaine phase.
  </div>
);

export function SpaceWorkspace() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [groupFromSpaceOpen, setGroupFromSpaceOpen] = useState(false);

  const treeFn = useServerFn(getSpaceTree);
  const { data: tree } = useQuery({
    queryKey: ["collab-tree"],
    queryFn: () => treeFn(),
  });
  const active = tree?.spaces.find((s) => s.id === activeId) ?? null;

  const activityFn = useServerFn(getSpaceActivity);
  const { data: activity } = useQuery({
    queryKey: ["space-activity", activeId],
    queryFn: () => activityFn({ data: { spaceId: activeId! } }),
    enabled: !!activeId,
  });

  const handleSelect = (id: string | null) => {
    setActiveId(id);
    if (isMobile) setTreeOpen(false);
  };

  const aboutPanel = active && (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-1">À propos</h3>
        <div className="text-sm">
          <div className="font-medium">{active.name}</div>
          {active.type && (
            <div className="text-xs text-muted-foreground capitalize">{active.type}</div>
          )}
        </div>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Activité 7j</h3>
        <div className="text-xs space-y-1.5">
          <div>💬 {activity?.messages.length ?? 0} message(s)</div>
          <div>🔗 {activity?.links.length ?? 0} lien(s) créé(s)</div>
          {activity?.messages[0] && (
            <div className="text-muted-foreground">
              Dernier message{" "}
              {formatDistanceToNow(new Date(activity.messages[0].message_at), {
                addSuffix: true,
                locale: fr,
              })}
            </div>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full justify-start"
        onClick={() => setGroupFromSpaceOpen(true)}
      >
        👥 Créer un groupe depuis cet espace
      </Button>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] border-t">
      {/* Sidebar gauche : permanente ≥ md, en Sheet sur mobile */}
      <aside className="hidden md:block w-[240px] lg:w-[260px] border-r bg-card/30 shrink-0">
        <SpaceTree activeSpaceId={activeId} onSelect={handleSelect} />
      </aside>

      <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
        <SheetContent side="left" className="p-0 w-[85vw] max-w-[320px]">
          <SheetHeader className="sr-only">
            <SheetTitle>Espaces collaboratifs</SheetTitle>
          </SheetHeader>
          <SpaceTree activeSpaceId={activeId} onSelect={handleSelect} />
        </SheetContent>
      </Sheet>

      <main className="flex-1 flex min-w-0">
        <div className="flex-1 flex flex-col min-w-0">
          {!active ? (
            <>
              {/* Header mobile pour ouvrir l'arborescence depuis le dashboard */}
              <div className="md:hidden border-b px-3 py-2 flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTreeOpen(true)}>
                  <Menu className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium">Collaboratif</span>
              </div>
              <CollabDashboard onSelect={setActiveId} />
            </>
          ) : (
            <>
              <header className="border-b px-3 sm:px-4 py-2 sm:py-3 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 md:hidden"
                  onClick={() => setTreeOpen(true)}
                  title="Espaces"
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <span className="text-xl">{active.icon ?? "📁"}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold truncate text-sm sm:text-base">{active.name}</h2>
                </div>
                <SpaceShareButton spaceId={active.id} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setRightOpen((v) => !v)}
                  title={rightOpen ? "Masquer panneau" : "Afficher panneau"}
                >
                  <span className="hidden lg:inline">
                    {rightOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                  </span>
                  <span className="lg:hidden">
                    <Info className="h-4 w-4" />
                  </span>
                </Button>
              </header>

              <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
                <TabsList className="mx-2 sm:mx-3 mt-2 w-[calc(100%-1rem)] sm:w-[calc(100%-1.5rem)] overflow-x-auto flex-nowrap justify-start">
                  <TabsTrigger value="chat" className="gap-1 text-xs sm:text-sm">
                    <Hash className="h-3.5 w-3.5" /> Chat
                  </TabsTrigger>
                  <TabsTrigger value="links" className="gap-1 text-xs sm:text-sm">
                    <Link2 className="h-3.5 w-3.5" /> Liens
                  </TabsTrigger>
                  <TabsTrigger value="docs" className="gap-1 text-xs sm:text-sm">
                    <FileText className="h-3.5 w-3.5" /> Docs
                  </TabsTrigger>
                  <TabsTrigger value="tasks" className="gap-1 text-xs sm:text-sm">
                    <CheckSquare className="h-3.5 w-3.5" /> Tâches
                  </TabsTrigger>
                  <TabsTrigger value="meetings" className="gap-1 text-xs sm:text-sm">
                    <CalendarClock className="h-3.5 w-3.5" /> Réunions
                  </TabsTrigger>
                  <TabsTrigger value="files" className="gap-1 text-xs sm:text-sm">
                    <Paperclip className="h-3.5 w-3.5" /> Fichiers
                  </TabsTrigger>
                  <TabsTrigger value="polls" className="gap-1 text-xs sm:text-sm">
                    <Vote className="h-3.5 w-3.5" /> Sondages
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="chat" className="flex-1 min-h-0 mt-2">
                  {user && <SpaceChat spaceId={active.id} currentUserId={user.id} />}
                </TabsContent>
                <TabsContent value="links" className="flex-1 min-h-0 mt-2 overflow-y-auto">
                  <SpaceLinksTab spaceId={active.id} />
                </TabsContent>
                <TabsContent value="docs" className="flex-1 min-h-0 mt-2 overflow-y-auto p-3">
                  <DocumentsTab spaceId={active.id} />
                </TabsContent>
                <TabsContent value="tasks" className="flex-1 min-h-0 mt-2 overflow-y-auto">
                  <SpaceTasksTab spaceId={active.id} />
                </TabsContent>
                <TabsContent value="meetings" className="flex-1 min-h-0 mt-2 overflow-y-auto">
                  <SpaceMeetingsTab spaceId={active.id} />
                </TabsContent>
                <TabsContent value="files" className="flex-1 min-h-0 mt-2 overflow-y-auto">
                  <SpaceFilesTab spaceId={active.id} />
                </TabsContent>
                <TabsContent value="polls" className="flex-1 min-h-0 mt-2 overflow-y-auto">
                  <SpacePollsTab spaceId={active.id} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>

        {/* Panneau droit : ancré ≥ lg, en Sheet sur tablette/mobile */}
        {active && rightOpen && (
          <aside className="w-[280px] border-l bg-card/30 shrink-0 overflow-y-auto p-4 hidden lg:block">
            {aboutPanel}
          </aside>
        )}
      </main>

      <Sheet
        open={!!active && rightOpen}
        onOpenChange={(o) => {
          // Le Sheet ne sert que sous lg ; au-dessus on a l'aside latéral
          if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) return;
          setRightOpen(o);
        }}
      >
        <SheetContent side="right" className="w-[85vw] max-w-[320px] lg:hidden">
          <SheetHeader>
            <SheetTitle>À propos</SheetTitle>
          </SheetHeader>
          <div className="mt-4">{aboutPanel}</div>
        </SheetContent>
      </Sheet>

      {active && (
        <GroupFormDialog
          open={groupFromSpaceOpen}
          onOpenChange={setGroupFromSpaceOpen}
          onCreated={() => setGroupFromSpaceOpen(false)}
          defaultSpaceId={active.id}
          defaultType="space"
        />
      )}
    </div>
  );
}
