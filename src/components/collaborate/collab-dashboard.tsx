import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Loader2, MessageSquare, Link2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getSpaceActivity, getSpaceTree, countPendingWaSuggestions } from "@/lib/collab.functions";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Props {
  onSelect: (spaceId: string) => void;
}

export function CollabDashboard({ onSelect }: Props) {
  const activityFn = useServerFn(getSpaceActivity);
  const treeFn = useServerFn(getSpaceTree);

  const { data: activity, isLoading } = useQuery({
    queryKey: ["collab-activity-all"],
    queryFn: () => activityFn({ data: {} }),
  });
  const { data: tree } = useQuery({
    queryKey: ["collab-tree"],
    queryFn: () => treeFn(),
  });

  const spaceName = (id: string) =>
    tree?.spaces.find((s) => s.id === id)?.name ?? "(espace)";
  const spaceIcon = (id: string) =>
    tree?.spaces.find((s) => s.id === id)?.icon ?? "📁";

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <header>
        <h2 className="text-xl font-semibold">Fil global</h2>
        <p className="text-sm text-muted-foreground">
          Activité récente sur tous tes espaces (7 derniers jours).
        </p>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Derniers messages
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(activity?.messages ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground">Rien de récent.</div>
              )}
              {(activity?.messages ?? []).slice(0, 10).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={cn(
                    "w-full text-left text-sm rounded-md px-2 py-1.5 hover:bg-accent/60",
                  )}
                  onClick={() => onSelect(m.space_id)}
                >
                  <div className="text-xs text-muted-foreground">
                    {spaceIcon(m.space_id)} {spaceName(m.space_id)} ·{" "}
                    {formatDistanceToNow(new Date(m.message_at), { addSuffix: true, locale: fr })}
                  </div>
                  <div className="truncate">{m.content}</div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Link2 className="h-4 w-4" /> Liens créés
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(activity?.links ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground">Aucun lien récent.</div>
              )}
              {(activity?.links ?? []).slice(0, 10).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="w-full text-left text-sm rounded-md px-2 py-1.5 hover:bg-accent/60"
                  onClick={() => onSelect(l.space_id)}
                >
                  <div className="text-xs text-muted-foreground">
                    {spaceIcon(l.space_id)} {spaceName(l.space_id)} ·{" "}
                    {formatDistanceToNow(new Date(l.created_at), { addSuffix: true, locale: fr })}
                  </div>
                  <div className="truncate">
                    {l.entity_type} → <span className="font-mono text-xs">{l.entity_id.slice(0, 8)}</span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
