import { useMemo, useState } from "react";
import {
  Plus,
  Paperclip,
  Mail,
  Pencil,
  Trash2,
  Clock,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Check,
  Circle,
  Archive,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SwipeableRow, type SwipeAction } from "@/components/inbox/swipeable-row";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  type Task,
  type TaskStatus,
  STATUS_COLUMNS,
  PRIORITY_META,
  SOURCE_META,
  getSection,
} from "@/lib/tasks-model";

type Props = {
  tasks: Task[];
  onMove: (task: Task, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onCreate: (status: TaskStatus) => void;
  onOpenEmail: (emailId: string) => void;
};

// Vertical stack: todo + in_progress always open (most important), done/archived collapsible.
const PRIMARY: TaskStatus[] = ["todo", "in_progress"];

export function KanbanView({ tasks, onMove, onEdit, onDelete, onCreate, onOpenEmail }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [collapsed, setCollapsed] = useState<Record<TaskStatus, boolean>>({
    todo: false,
    in_progress: false,
    done: true,
    archived: true,
  });

  const grouped = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>();
    STATUS_COLUMNS.forEach((c) => m.set(c.id, []));
    tasks.forEach((t) => m.get(t.status)?.push(t));
    return m;
  }, [tasks]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-2">
      {STATUS_COLUMNS.map((col) => {
        const items = grouped.get(col.id) ?? [];
        const isOver = overCol === col.id;
        const isPrimary = PRIMARY.includes(col.id);
        const isCollapsed = collapsed[col.id];
        return (
          <section
            key={col.id}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col.id);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setOverCol(null);
              const id = e.dataTransfer.getData("text/task-id");
              const t = tasks.find((x) => x.id === id);
              if (t && t.status !== col.id) onMove(t, col.id);
            }}
            className={cn(
              "flex flex-col rounded-xl border bg-muted/30 transition-colors",
              isOver && "border-primary bg-primary/5",
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
                <span>{col.icon}</span>
                <h3 className={cn("font-semibold", isPrimary ? "text-sm sm:text-base" : "text-sm")}>
                  {col.label}
                </h3>
              </button>
              <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
              <button
                onClick={() => onCreate(col.id)}
                className="ml-1 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="inline h-3 w-3" />
              </button>
            </header>
            {!isCollapsed && (
              <div
                className={cn(
                  "grid gap-2 p-2",
                  "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
                )}
              >
                {items.map((t) => {
                  const leftActions: SwipeAction[] =
                    t.status !== "done"
                      ? [
                          {
                            key: "done",
                            label: "Terminé",
                            icon: <Check className="h-4 w-4" />,
                            color: "bg-emerald-500",
                            onAction: () => onMove(t, "done"),
                          },
                        ]
                      : [
                          {
                            key: "todo",
                            label: "À faire",
                            icon: <Circle className="h-4 w-4" />,
                            color: "bg-slate-500",
                            onAction: () => onMove(t, "todo"),
                          },
                        ];
                  const rightActions: SwipeAction[] = [
                    ...(t.status !== "archived"
                      ? [
                          {
                            key: "archive",
                            label: "Archiver",
                            icon: <Archive className="h-4 w-4" />,
                            color: "bg-slate-500",
                            onAction: () => onMove(t, "archived"),
                          },
                        ]
                      : []),
                    {
                      key: "delete",
                      label: "Suppr.",
                      icon: <Trash2 className="h-4 w-4" />,
                      color: "bg-destructive",
                      onAction: () => onDelete(t),
                    },
                  ];

                  return (
                    <SwipeableRow
                      key={t.id}
                      leftActions={leftActions}
                      rightActions={rightActions}
                      className="rounded-md"
                    >
                      <Card
                        task={t}
                        dragging={dragId === t.id}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/task-id", t.id);
                          setDragId(t.id);
                        }}
                        onDragEnd={() => setDragId(null)}
                        onClick={() => onEdit(t)}
                        onEdit={() => onEdit(t)}
                        onDelete={() => onDelete(t)}
                        onMove={(s) => onMove(t, s)}
                        onOpenEmail={() => t.source_email_id && onOpenEmail(t.source_email_id)}
                      />
                    </SwipeableRow>
                  );
                })}
                {items.length === 0 && (
                  <div className="col-span-full rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
                    Aucune tâche
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Card({
  task,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
  onEdit,
  onDelete,
  onMove,
  onOpenEmail,
}: {
  task: Task;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (s: TaskStatus) => void;
  onOpenEmail: () => void;
}) {
  const overdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== "done";
  const section = getSection(task);
  const tagsClean = (task.tags ?? []).filter(
    (t) => !t.startsWith("section:") && !t.startsWith("recurrence:"),
  );
  const meta = PRIORITY_META[task.priority];
  const src = SOURCE_META[task.source_app];

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-md border bg-card p-2.5 text-sm shadow-sm transition-all hover:shadow-md hover:border-primary/40",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", meta.dot)} title={meta.label} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <h4 className="flex-1 text-sm font-medium leading-snug">{task.title}</h4>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="text-muted-foreground opacity-100 sm:opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Éditer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground">
                  Déplacer vers
                </DropdownMenuLabel>
                {STATUS_COLUMNS.filter((c) => c.id !== task.status).map((c) => (
                  <DropdownMenuItem key={c.id} onClick={() => onMove(c.id)}>
                    <ArrowRight className="mr-2 h-3.5 w-3.5" /> {c.icon} {c.label}
                  </DropdownMenuItem>
                ))}
                {task.source_email_id && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onOpenEmail}>
                      <Mail className="mr-2 h-3.5 w-3.5" /> Voir email source
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Supprimer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {task.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="gap-0.5 text-[10px]">
              {meta.emoji} {meta.label}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {section === "CHU" ? "📧" : section === "Université" ? "🎓" : src.emoji} {section}
            </Badge>
            {task._pending && (
              <Badge className="bg-amber-500/15 text-[10px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-400">
                ⏳ sync
              </Badge>
            )}
            {task.source_email_id && <Mail className="h-3 w-3 text-muted-foreground" />}
            {(task.tags ?? []).some((t) => t === "attachment") && (
              <Paperclip className="h-3 w-3 text-muted-foreground" />
            )}
          </div>

          {tagsClean.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tagsClean.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {task.due_date && (
            <div
              className={cn(
                "mt-1.5 flex items-center gap-1 text-[11px]",
                overdue ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              <Clock className="h-3 w-3" />
              {new Date(task.due_date).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "short",
              })}
              {overdue && " — en retard"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
