import { createFileRoute, Link } from "@tanstack/react-router";
import { SpacesList } from "@/components/collaborate/spaces-list";
import { Button } from "@/components/ui/button";
import { ClipboardCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/collaborate")({
  component: CollaboratePage,
  head: () => ({
    meta: [{ title: "Espace collaboratif – MyHub Pro" }],
  }),
});

function CollaboratePage() {
  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Espace collaboratif</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vos cercles, projets et groupes. Importez l'historique WhatsApp pour transformer
            les conversations en actions, réunions et décisions.
          </p>
        </div>
        <Link to="/collaborate/review">
          <Button variant="outline">
            <ClipboardCheck className="h-4 w-4 mr-2" />
            Revue des propositions
          </Button>
        </Link>
      </header>
      <SpacesList />
    </div>
  );
}

