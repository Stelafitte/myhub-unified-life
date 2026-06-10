import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  MoreVertical,
  Hammer,
  PlayCircle,
  CheckCircle2,
  Archive,
  ChevronDown,
  ChevronRight,
  List,
  LayoutGrid,
  GanttChart,
  ArrowRight,
  Clock,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
type View = "kanban" | "list" | "gantt";

const SECTIONS: { id: Status; label: string; icon: React.ComponentType<{ className?: string }>; dot: string }[] = [
  { id: "construction", label: "En construction", icon: Hammer, dot: "bg-amber-500" },
  { id: "active", label: "En cours", icon: PlayCircle, dot: "bg-blue-500" },
  { id: "done", label: "Terminés", icon: CheckCircle2, dot: "bg-emerald-500" },
  { id: "archived", label: "Archivés", icon: Archive, dot: "bg-slate-400" },
];


const PRIMARY: Status[] = ["construction", "active"];

export function CollabDashboard({ onSelect }: Props) {
  const listFn = useServerFn(listSpacesForDashboard);
  const setStatusFn = useServerFn(setSpaceLifecycleStatus);
  const qc = useQueryClient();

  const [view, setView] = useState<View>("kanban");
  const [collapsed, setCollapsed] = useState<Record<Status, boolean>>({
    construction: false,
    active: false,
    done: true,
    archived: true,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["collab-dashboard-spaces"],
    queryFn: () => listFn(),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { spaceId: string; status: Status }) => setStatusFn({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(`Espace déplacé vers « ${SECTIONS.find((c) => c.id === vars.status)?.label} »`);
      qc.invalidateQueries({ queryKey: ["collab-dashboard-spaces"] });
      qc.invalidateQueries({ queryKey: ["collab-tree"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  type SpaceRow = NonNullable<typeof data>["spaces"][number];
  const grouped = useMemo(() => {
    const map: Record<Status, SpaceRow[]> = { construction: [], active: [], done: [], archived: [] };
    for (const s of data?.spaces ?? []) {
      const st: Status = (s.archived_at ? "archived" : ((s.lifecycle_status as Status) || "active"));
      map[st].push(s);
    }
    return map;
  }, [data]);

  const allSpaces = data?.spaces ?? [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const renderCard = (s: SpaceRow, currentStatus: Status) => {
    const sec = SECTIONS.find((c) => c.id === currentStatus)!;
    return (
      <article
        key={s.id}
        className="group cursor-pointer rounded-md border bg-card p-2.5 text-sm shadow-sm transition-all hover:shadow-md hover:border-primary/40 h-full flex flex-col"
        onClick={() => onSelect(s.id)}
      >
        <div className="flex items-start gap-2">
          <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", sec.dot)} title={sec.label} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1">
              <h4 className="flex-1 text-sm font-medium leading-snug">
                <span className="mr-1">{s.icon ?? "📁"}</span>
                {s.name}
              </h4>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground opacity-100 sm:opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground">
                    Déplacer vers
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {SECTIONS.filter((c) => c.id !== currentStatus).map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      onClick={() => setStatus.mutate({ spaceId: s.id, status: c.id })}
                    >
                      <ArrowRight className="mr-2 h-3.5 w-3.5" />
                      <c.icon className="mr-1 h-3.5 w-3.5" /> {c.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1">
              <Badge variant="outline" className="gap-0.5 text-[10px]">
                <sec.icon className="h-3 w-3" /> {sec.label}
              </Badge>
              {s.type && (
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {s.type}
                </Badge>
              )}
            </div>

            {s.updated_at && (
              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(s.updated_at), { addSuffix: true, locale: fr })}
              </div>
            )}
          </div>
        </div>
      </article>
    );
  };


  return (
    <div className="flex flex-1 flex-col p-3 sm:p-4 md:p-6 overflow-hidden">
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4 sm:gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold tracking-tight sm:text-2xl">Espaces collaboratifs</h2>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {allSpaces.length} espace{allSpaces.length > 1 ? "s" : ""} · 4 sections
          </p>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border">
          <button
            onClick={() => setView("list")}
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 text-xs transition-colors sm:gap-1.5 sm:px-3 sm:text-sm",
              view === "list" ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            <List className="h-4 w-4" />
            <span className="hidden sm:inline">Liste</span>
          </button>
          <button
            onClick={() => setView("kanban")}
            className={cn(
              "flex items-center gap-1 border-l px-2 py-1.5 text-xs transition-colors sm:gap-1.5 sm:px-3 sm:text-sm",
              view === "kanban" ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Kanban</span>
          </button>
          <button
            onClick={() => setView("gantt")}
            className={cn(
              "flex items-center gap-1 border-l px-2 py-1.5 text-xs transition-colors sm:gap-1.5 sm:px-3 sm:text-sm",
              view === "gantt" ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            <GanttChart className="h-4 w-4" />
            <span className="hidden sm:inline">Gantt</span>
          </button>
        </div>
      </div>

      {view === "kanban" && (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-2">
          {SECTIONS.map((col) => {
            const items = grouped[col.id] ?? [];
            const isPrimary = PRIMARY.includes(col.id);
            const isCollapsed = collapsed[col.id];
            const Icon = col.icon;
            return (
              <section
                key={col.id}
                className={cn(
                  "flex flex-col rounded-xl border bg-muted/30",
                  isPrimary && "ring-1 ring-primary/10",
                )}
              >
                <header className="flex items-center gap-2 border-b bg-background/60 px-3 py-2">
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [col.id]: !c[col.id] }))}
                    className="flex items-center gap-1.5 text-left"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    <Icon className="h-4 w-4" />
                    <h3 className={cn("font-semibold", isPrimary ? "text-sm sm:text-base" : "text-sm")}>
                      {col.label}
                    </h3>
                  </button>
                  <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
                </header>
                {!isCollapsed && (
                  <div className="grid gap-2 p-2 auto-rows-fr grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {items.map((s) => renderCard(s, col.id))}
                    {items.length === 0 && (
                      <div className="col-span-full rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
                        Aucun espace
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {view === "list" && (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-2">
          {SECTIONS.map((col) => {
            const items = grouped[col.id] ?? [];
            const isCollapsed = collapsed[col.id];
            const Icon = col.icon;
            return (
              <section key={col.id} className="flex flex-col rounded-xl border bg-muted/30">
                <header className="flex items-center gap-2 border-b bg-background/60 px-3 py-2">
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [col.id]: !c[col.id] }))}
                    className="flex items-center gap-1.5 text-left"
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <Icon className="h-4 w-4" />
                    <h3 className="text-sm font-semibold">{col.label}</h3>
                  </button>
                  <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
                </header>
                {!isCollapsed && (
                  <div className="divide-y">
                    {items.length === 0 && (
                      <div className="py-4 text-center text-xs text-muted-foreground">Aucun espace</div>
                    )}
                    {items.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50 cursor-pointer"
                        onClick={() => onSelect(s.id)}
                      >
                        <span className="text-base">{s.icon ?? "📁"}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{s.name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {s.type && <span className="capitalize">{s.type} · </span>}
                            {s.updated_at
                              ? formatDistanceToNow(new Date(s.updated_at), { addSuffix: true, locale: fr })
                              : null}
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuLabel className="text-xs">Déplacer vers</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {SECTIONS.filter((c) => c.id !== col.id).map((c) => (
                              <DropdownMenuItem
                                key={c.id}
                                onClick={() => setStatus.mutate({ spaceId: s.id, status: c.id })}
                              >
                                <c.icon className="mr-2 h-3.5 w-3.5" /> {c.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {view === "gantt" && (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-2">
          {SECTIONS.map((col) => {
            const items = grouped[col.id] ?? [];
            const isCollapsed = collapsed[col.id];
            const Icon = col.icon;
            return (
              <section key={col.id} className="flex flex-col rounded-xl border bg-muted/30">
                <header className="flex items-center gap-2 border-b bg-background/60 px-3 py-2">
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [col.id]: !c[col.id] }))}
                    className="flex items-center gap-1.5 text-left"
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <Icon className="h-4 w-4" />
                    <h3 className="text-sm font-semibold">{col.label}</h3>
                  </button>
                  <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
                </header>
                {!isCollapsed && (
                  <div className="space-y-1.5 p-3">
                    {items.length === 0 && (
                      <div className="py-3 text-center text-xs text-muted-foreground">Aucun espace</div>
                    )}
                    {items.map((s) => {
                      const updated = s.updated_at ? new Date(s.updated_at) : null;
                      const now = Date.now();
                      const ageDays = updated
                        ? Math.max(1, Math.min(60, (now - updated.getTime()) / 86400000))
                        : 30;
                      const widthPct = Math.max(8, 100 - (ageDays / 60) * 92);
                      return (
                        <button
                          key={s.id}
                          onClick={() => onSelect(s.id)}
                          className="w-full text-left group"
                        >
                          <div className="flex items-center gap-2 text-xs">
                            <span className="w-44 truncate font-medium">
                              {s.icon ?? "📁"} {s.name}
                            </span>
                            <div className="flex-1 h-4 rounded bg-muted relative overflow-hidden">
                              <div
                                className="absolute inset-y-0 left-0 bg-primary/40 group-hover:bg-primary/60 transition-colors"
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                            <span className="w-24 text-right text-muted-foreground tabular-nums">
                              {updated
                                ? formatDistanceToNow(updated, { addSuffix: true, locale: fr })
                                : "—"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

    </div>
  );
}
