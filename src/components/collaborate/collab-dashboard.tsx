import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MoreVertical, Hammer, PlayCircle, CheckCircle2, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { listSpacesForDashboard, setSpaceLifecycleStatus } from "@/lib/collab.functions";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  onSelect: (spaceId: string) => void;
}

type Status = "construction" | "active" | "done" | "archived";

const COLUMNS: { id: Status; label: string; icon: React.ComponentType<{ className?: string }>; accent: string }[] = [
  { id: "construction", label: "En construction", icon: Hammer, accent: "border-amber-500/40 bg-amber-500/5" },
  { id: "active", label: "En cours", icon: PlayCircle, accent: "border-blue-500/40 bg-blue-500/5" },
  { id: "done", label: "Terminés", icon: CheckCircle2, accent: "border-emerald-500/40 bg-emerald-500/5" },
  { id: "archived", label: "Archivés", icon: Archive, accent: "border-muted bg-muted/30" },
];

export function CollabDashboard({ onSelect }: Props) {
  const listFn = useServerFn(listSpacesForDashboard);
  const setStatusFn = useServerFn(setSpaceLifecycleStatus);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["collab-dashboard-spaces"],
    queryFn: () => listFn(),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { spaceId: string; status: Status }) =>
      setStatusFn({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(`Espace déplacé vers « ${COLUMNS.find((c) => c.id === vars.status)?.label} »`);
      qc.invalidateQueries({ queryKey: ["collab-dashboard-spaces"] });
      qc.invalidateQueries({ queryKey: ["collab-tree"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  type SpaceRow = NonNullable<typeof data>["spaces"][number];
  const grouped = useMemo(() => {
    const map: Record<Status, SpaceRow[]> = {
      construction: [],
      active: [],
      done: [],
      archived: [],
    };
    for (const s of data?.spaces ?? []) {
      const st: Status = (s.archived_at ? "archived" : ((s.lifecycle_status as Status) || "active"));
      map[st].push(s);
    }
    return map;
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
      <header>
        <h2 className="text-xl font-semibold">Espaces collaboratifs</h2>
        <p className="text-sm text-muted-foreground">
          Suivi du cycle de vie de tes espaces — déplace une carte vers une autre colonne via le menu.
        </p>
      </header>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = grouped[col.id] ?? [];
          const Icon = col.icon;
          return (
            <section
              key={col.id}
              className={cn("rounded-lg border p-2.5 flex flex-col min-h-[200px]", col.accent)}
            >
              <header className="flex items-center justify-between px-1 pb-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon className="h-4 w-4" />
                  {col.label}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
              </header>
              <div className="space-y-1.5 flex-1">
                {items.length === 0 && (
                  <div className="text-xs text-muted-foreground px-1 py-3 text-center">
                    Aucun espace
                  </div>
                )}
                {items.map((s) => (
                  <article
                    key={s.id}
                    className="group rounded-md border bg-background/80 hover:bg-background hover:shadow-sm transition p-2 flex items-start gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-base leading-none">{s.icon ?? "📁"}</span>
                        <span className="text-sm font-medium truncate">{s.name}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {s.type ? <span className="capitalize">{s.type}</span> : null}
                        {s.type && s.updated_at ? " · " : ""}
                        {s.updated_at
                          ? formatDistanceToNow(new Date(s.updated_at), { addSuffix: true, locale: fr })
                          : null}
                      </div>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-60 hover:opacity-100 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuLabel className="text-xs">Déplacer vers</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {COLUMNS.filter((c) => c.id !== col.id).map((c) => (
                          <DropdownMenuItem
                            key={c.id}
                            onClick={() => setStatus.mutate({ spaceId: s.id, status: c.id })}
                          >
                            <c.icon className="h-3.5 w-3.5 mr-2" />
                            {c.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
