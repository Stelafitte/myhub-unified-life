import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Loader2, Mail, CircleDot, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listSpaceCollaborators } from "@/lib/collab.functions";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export function SpaceCollaboratorsTab({ spaceId }: { spaceId: string }) {
  const fn = useServerFn(listSpaceCollaborators);
  const { data, isLoading, error } = useQuery({
    queryKey: ["space-collaborators", spaceId],
    queryFn: () => fn({ data: { spaceId } }),
  });

  const rows = useMemo(() => data?.collaborators ?? [], [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Chargement…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Erreur : {error instanceof Error ? error.message : "inconnue"}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground space-y-2">
        <Users className="h-8 w-8 mx-auto text-muted-foreground/50" />
        <p>Aucun collaborateur pour l'instant.</p>
        <p className="text-xs">
          Liez un groupe de contacts à ce projet ou ajoutez des invités via le bouton « Partager ».
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Collaborateurs</h3>
        <Badge variant="secondary">{rows.length}</Badge>
        {data?.groupCount ? (
          <span className="text-xs text-muted-foreground">
            · {data.groupCount} groupe{data.groupCount > 1 ? "s" : ""} lié{data.groupCount > 1 ? "s" : ""}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Membres des groupes de contacts liés à ce projet, plus les invités. L'horodatage de dernière
        connexion est mis à jour à chaque ouverture du lien personnel.
      </p>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="hidden md:table-cell">Organisation</TableHead>
              <TableHead className="hidden lg:table-cell">Groupe(s)</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Dernière connexion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-xs">
                  {r.email ? (
                    <a
                      href={`mailto:${r.email}`}
                      className="inline-flex items-center gap-1 hover:underline text-muted-foreground"
                    >
                      <Mail className="h-3 w-3" /> {r.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {r.organization ?? "—"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {r.group_names.length > 0 ? (
                      r.group_names.map((g) => (
                        <Badge key={g} variant="outline" className="text-[10px]">
                          {g}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {r.invited ? (
                    <Badge
                      variant={r.status === "active" ? "default" : "secondary"}
                      className="text-[10px] gap-1"
                    >
                      <CircleDot className="h-2.5 w-2.5" />
                      {r.status === "active" ? "Invité actif" : r.status ?? "Invité"}
                      {r.role ? ` · ${r.role === "contributor" ? "Contrib." : "Lect."}` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      Non invité
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {r.last_active_at ? (
                    <span
                      className="inline-flex items-center gap-1 text-muted-foreground"
                      title={new Date(r.last_active_at).toLocaleString("fr-FR")}
                    >
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(r.last_active_at), {
                        addSuffix: true,
                        locale: fr,
                      })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/60">Jamais</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
