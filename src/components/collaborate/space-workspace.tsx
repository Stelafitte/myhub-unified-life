import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PanelRightClose, PanelRightOpen, Hash, Link2, FileText, CheckSquare, CalendarClock, Vote, Smartphone, Paperclip } from "lucide-react";
import { SpaceTree } from "./space-tree";
import { SpaceChat } from "./space-chat";
import { SpaceLinksTab } from "./space-links-tab";
import { SpaceTasksTab } from "./space-tasks-tab";
import { SpaceMeetingsTab } from "./space-meetings-tab";
import { DocumentsTab } from "./documents-tab";
import { SpaceFilesTab } from "./space-files-tab";
import { SpaceWhatsappTab } from "./space-whatsapp-tab";
import { SpacePollsTab } from "./space-polls-tab";
import { SpaceShareButton } from "./space-share-button";
import { CollabDashboard } from "./collab-dashboard";
import { GroupFormDialog } from "@/components/contacts/group-form-dialog";
import { getSpaceTree, getSpaceActivity } from "@/lib/collab.functions";
import { useAuth } from "@/lib/auth-context";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

const COMING_SOON = (
  <div className="p-8 text-center text-sm text-muted-foreground">
    Cette section arrive dans une prochaine phase.
  </div>
);

export function SpaceWorkspace() {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
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

  return (
    <div className="flex h-[calc(100vh-3.5rem)] border-t">
      <aside className="w-[260px] border-r bg-card/30 shrink-0">
        <SpaceTree activeSpaceId={activeId} onSelect={setActiveId} />
      </aside>

      <main className="flex-1 flex min-w-0">
        <div className="flex-1 flex flex-col min-w-0">
          {!active ? (
            <CollabDashboard onSelect={setActiveId} />
          ) : (
            <>
              <header className="border-b px-4 py-3 flex items-center gap-2">
                <span className="text-xl">{active.icon ?? "📁"}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold truncate">{active.name}</h2>
                </div>
                <SpaceShareButton spaceId={active.id} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setRightOpen((v) => !v)}
                  title={rightOpen ? "Masquer panneau" : "Afficher panneau"}
                >
                  {rightOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                </Button>
              </header>

              <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
                <TabsList className="mx-3 mt-2 w-fit max-w-[calc(100%-1.5rem)] overflow-x-auto flex-nowrap justify-start">
                  <TabsTrigger value="chat" className="gap-1">
                    <Hash className="h-3.5 w-3.5" /> Chat
                  </TabsTrigger>
                  <TabsTrigger value="links" className="gap-1">
                    <Link2 className="h-3.5 w-3.5" /> Liens
                  </TabsTrigger>
                  <TabsTrigger value="docs" className="gap-1">
                    <FileText className="h-3.5 w-3.5" /> Docs
                  </TabsTrigger>
                  <TabsTrigger value="tasks" className="gap-1">
                    <CheckSquare className="h-3.5 w-3.5" /> Tâches
                  </TabsTrigger>
                  <TabsTrigger value="meetings" className="gap-1">
                    <CalendarClock className="h-3.5 w-3.5" /> Réunions
                  </TabsTrigger>
                  <TabsTrigger value="files" className="gap-1">
                    <Paperclip className="h-3.5 w-3.5" /> Fichiers
                  </TabsTrigger>
                  <TabsTrigger value="wa" className="gap-1">
                    <Smartphone className="h-3.5 w-3.5" /> WhatsApp
                  </TabsTrigger>
                  <TabsTrigger value="polls" className="gap-1">
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
                <TabsContent value="wa" className="flex-1 min-h-0 mt-2 overflow-y-auto">
                  <SpaceWhatsappTab spaceId={active.id} />
                </TabsContent>
                <TabsContent value="polls" className="flex-1 min-h-0 mt-2 overflow-y-auto">
                  <SpacePollsTab spaceId={active.id} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>

        {active && rightOpen && (
          <aside className="w-[280px] border-l bg-card/30 shrink-0 overflow-y-auto p-4 space-y-4 hidden lg:block">
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
                <div>
                  💬 {activity?.messages.length ?? 0} message(s)
                </div>
                <div>
                  🔗 {activity?.links.length ?? 0} lien(s) créé(s)
                </div>
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
            <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setGroupFromSpaceOpen(true)}>
              👥 Créer un groupe depuis cet espace
            </Button>
          </aside>
        )}
      </main>
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
