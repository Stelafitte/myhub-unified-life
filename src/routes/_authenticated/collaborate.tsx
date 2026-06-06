import { createFileRoute, Link } from "@tanstack/react-router";
import { SpaceWorkspace } from "@/components/collaborate/space-workspace";
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
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <header className="px-4 py-2 flex items-center justify-between border-b shrink-0">
        <div>
          <h1 className="text-base font-semibold">Espace collaboratif</h1>
        </div>
        <Link to="/collaborate/review">
          <Button variant="outline" size="sm">
            <ClipboardCheck className="h-4 w-4 mr-2" />
            Revue propositions
          </Button>
        </Link>
      </header>
      <div className="flex-1 min-h-0">
        <SpaceWorkspace />
      </div>
    </div>
  );
}
