import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ClipboardList, CalendarClock, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPublicSpace } from "@/lib/collab.functions";

export const Route = createFileRoute("/space/$token")({
  head: () => ({
    meta: [
      { title: "Espace public" },
      { name: "description", content: "Espace collaboratif partagé publiquement." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PublicSpacePage,
});

function PublicSpacePage() {
  const { token } = Route.useParams();
  const fn = useServerFn(getPublicSpace);
  const { data, isLoading } = useQuery({
    queryKey: ["public-space", token],
    queryFn: () => fn({ data: { token } }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Chargement…
      </div>
    );
  }

  if (!data?.space) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 text-center">
        <h1 className="text-xl font-semibold mb-2">Espace introuvable</h1>
        <p className="text-sm text-muted-foreground">
          Ce lien n'est pas valide ou l'espace n'est plus public.
        </p>
      </div>
    );
  }

  const { space, surveys, polls } = data;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-12 h-12 rounded-md text-2xl"
            style={{
              backgroundColor: (space.color ?? "#64748b") + "20",
              color: space.color ?? undefined,
            }}
          >
            {space.icon ?? "📁"}
          </span>
          <div>
            <h1 className="text-2xl font-semibold">{space.name}</h1>
            <Badge variant="outline" className="text-[10px] mt-1">Espace public</Badge>
          </div>
        </div>
        {space.public_description && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {space.public_description}
          </p>
        )}
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          Sondages d'opinion ouverts
          <Badge variant="secondary">{surveys.length}</Badge>
        </h2>
        {surveys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun sondage ouvert.</p>
        ) : (
          <ul className="space-y-2">
            {surveys.map((s) => (
              <li key={s.id}>
                <Card className="p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{s.title}</div>
                    {s.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {s.description}
                      </p>
                    )}
                    {s.deadline && (
                      <div className="text-xs text-muted-foreground mt-1">
                        jusqu'au {format(new Date(s.deadline), "d MMM yyyy HH:mm", { locale: fr })}
                      </div>
                    )}
                  </div>
                  <Button asChild size="sm">
                    <a href={`/survey/${s.public_token}`}>
                      Répondre <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Sondages de réunion ouverts
          <Badge variant="secondary">{polls.length}</Badge>
        </h2>
        {polls.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun sondage de réunion ouvert.</p>
        ) : (
          <ul className="space-y-2">
            {polls.map((p) => (
              <li key={p.id}>
                <Card className="p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{p.title}</div>
                    {p.deadline && (
                      <div className="text-xs text-muted-foreground mt-1">
                        jusqu'au {format(new Date(p.deadline), "d MMM yyyy HH:mm", { locale: fr })}
                      </div>
                    )}
                  </div>
                  <Button asChild size="sm">
                    <a href={`/poll/${p.public_token}`}>
                      Voter <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="text-xs text-muted-foreground text-center pt-6 border-t">
        Page publique générée depuis MyHub Pro
      </footer>
    </div>
  );
}
