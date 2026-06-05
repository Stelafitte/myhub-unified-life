import { createFileRoute } from "@tanstack/react-router";
import { SpacesList } from "@/components/collaborate/spaces-list";

export const Route = createFileRoute("/_authenticated/collaborate")({
  component: CollaboratePage,
  head: () => ({
    meta: [{ title: "Espace collaboratif – MyHub Pro" }],
  }),
});

function CollaboratePage() {
  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Espace collaboratif</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vos cercles, projets et groupes. Importez l'historique WhatsApp pour transformer
          les conversations en actions, réunions et décisions.
        </p>
      </header>
      <SpacesList />
    </div>
  );
}
