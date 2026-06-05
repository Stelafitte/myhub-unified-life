import { createFileRoute, Link } from "@tanstack/react-router";
import { SuggestionsReview } from "@/components/collaborate/suggestions-review";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/collaborate/review")({
  component: ReviewPage,
  head: () => ({
    meta: [{ title: "Revue des propositions WhatsApp – MyHub Pro" }],
  }),
});

function ReviewPage() {
  return (
    <div className="container mx-auto py-8 max-w-5xl">
      <header className="mb-6">
        <Link to="/collaborate">
          <Button variant="ghost" size="sm" className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Espace collaboratif
          </Button>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Revue des propositions WhatsApp
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Validez ou rejetez chaque suggestion. Rien n'est créé dans Tâches ou Agenda
          tant que vous n'avez pas approuvé.
        </p>
      </header>
      <SuggestionsReview />
    </div>
  );
}
