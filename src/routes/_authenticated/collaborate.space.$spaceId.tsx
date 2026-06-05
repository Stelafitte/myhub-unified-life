import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2, MessageSquare, ListChecks, Calendar, FileText, Lightbulb } from "lucide-react";
import { DocumentsTab } from "@/components/collaborate/documents-tab";

export const Route = createFileRoute("/_authenticated/collaborate/space/$spaceId")({
  component: SpaceDetailPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-destructive mb-3">Erreur : {error.message}</p>
        <Button onClick={() => { reset(); router.invalidate(); }}>Réessayer</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Espace introuvable.</div>,
  head: () => ({ meta: [{ title: "Espace – MyHub Pro" }] }),
});

function SpaceDetailPage() {
  const { spaceId } = Route.useParams();
  const [space, setSpace] = useState<{ name: string; icon: string | null; color: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("collab_spaces")
        .select("name, icon, color")
        .eq("id", spaceId)
        .maybeSingle();
      setSpace(data ?? null);
      setLoading(false);
    })();
  }, [spaceId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Chargement…
      </div>
    );
  }

  if (!space) {
    return <div className="p-6">Espace introuvable.</div>;
  }

  return (
    <div className="container mx-auto py-6 max-w-7xl">
      <header className="mb-6">
        <Link to="/collaborate" className="text-sm text-muted-foreground hover:underline inline-flex items-center mb-3">
          <ChevronLeft className="h-3 w-3 mr-1" /> Espaces
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-md text-lg"
            style={{ backgroundColor: (space.color ?? "#64748b") + "20", color: space.color ?? undefined }}
          >
            {space.icon ?? "📁"}
          </span>
          {space.name}
        </h1>
      </header>

      <Tabs defaultValue="documents" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="documents">
            <FileText className="h-4 w-4 mr-2" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="conversations" disabled>
            <MessageSquare className="h-4 w-4 mr-2" />
            Conversations
          </TabsTrigger>
          <TabsTrigger value="tasks" disabled>
            <ListChecks className="h-4 w-4 mr-2" />
            Tâches
          </TabsTrigger>
          <TabsTrigger value="meetings" disabled>
            <Calendar className="h-4 w-4 mr-2" />
            Réunions
          </TabsTrigger>
          <TabsTrigger value="decisions" disabled>
            <Lightbulb className="h-4 w-4 mr-2" />
            Décisions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-0">
          <DocumentsTab spaceId={spaceId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
