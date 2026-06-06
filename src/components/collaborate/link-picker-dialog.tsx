import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, CheckSquare, CalendarClock, FileText, User, Plus } from "lucide-react";
import { linkEntityToSpace, searchLinkable } from "@/lib/collab.functions";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaceId: string;
  restrictTypes?: EntityType[];
}

type EntityType = "email" | "task" | "meeting" | "contact" | "document";

const META: Record<EntityType, { icon: typeof Mail; label: string }> = {
  email: { icon: Mail, label: "Emails" },
  task: { icon: CheckSquare, label: "Tâches" },
  meeting: { icon: CalendarClock, label: "Réunions" },
  contact: { icon: User, label: "Contacts" },
  document: { icon: FileText, label: "Documents" },
};

function labelFor(type: EntityType, e: Record<string, unknown>): string {
  switch (type) {
    case "email":
      return (e.subject as string) ?? (e.from_address as string) ?? "(sans sujet)";
    case "task":
      return (e.title as string) ?? "(tâche)";
    case "meeting":
      return (e.title as string) ?? "(réunion)";
    case "contact":
      return (
        [e.first_name, e.last_name].filter(Boolean).join(" ") ||
        (e.organization as string) ||
        "(contact)"
      );
    case "document":
      return (e.filename as string) ?? "(document)";
  }
}

export function LinkPickerDialog({ open, onOpenChange, spaceId, restrictTypes }: Props) {
  const [q, setQ] = useState("");
  const searchFn = useServerFn(searchLinkable);
  const linkFn = useServerFn(linkEntityToSpace);
  const qc = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: ["link-picker", q],
    queryFn: () => searchFn({ data: { q } }),
    enabled: q.trim().length >= 2,
  });

  const link = useMutation({
    mutationFn: (vars: { entityType: EntityType; entityId: string }) =>
      linkFn({ data: { spaceId, entityType: vars.entityType, entityId: vars.entityId } }),
    onSuccess: () => {
      toast.success("Lien créé");
      qc.invalidateQueries({ queryKey: ["space-links", spaceId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allGroups: EntityType[] = ["email", "task", "meeting", "contact", "document"];
  const groups: EntityType[] = restrictTypes?.length ? allGroups.filter((g) => restrictTypes.includes(g)) : allGroups;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Lier une entité à cet espace</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher (≥ 2 caractères)…"
          className="mb-2"
        />
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {q.trim().length < 2 ? (
            <div className="text-sm text-muted-foreground text-center py-10">
              Tape au moins 2 caractères.
            </div>
          ) : isFetching && !data ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            groups.map((type) => {
              const rows = (data?.[type] ?? []) as Record<string, unknown>[];
              if (!rows.length) return null;
              const Icon = META[type].icon;
              return (
                <section key={type}>
                  <div className="flex items-center gap-2 mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {META[type].label}
                  </div>
                  <div className="border rounded-md divide-y">
                    {rows.map((r) => (
                      <div
                        key={r.id as string}
                        className="flex items-center gap-2 px-3 py-2 text-sm"
                      >
                        <div className="flex-1 min-w-0 truncate">{labelFor(type, r)}</div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            link.mutate({ entityType: type, entityId: r.id as string })
                          }
                          disabled={link.isPending}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" /> Lier
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })
          )}
          {q.trim().length >= 2 &&
            data &&
            groups.every((t) => (data[t] ?? []).length === 0) && (
              <div className="text-sm text-muted-foreground text-center py-10">
                Aucun résultat.
              </div>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
