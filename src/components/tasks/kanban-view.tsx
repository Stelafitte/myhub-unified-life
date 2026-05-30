import { useMemo, useState } from "react";
import { Plus, Paperclip, Mail, Pencil, Trash2, Clock, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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

export function KanbanView({ tasks, onMove, onEdit, onDelete, onCreate, onOpenEmail }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>();
    STATUS_COLUMNS.forEach((c) => m.set(c.id, []));
    tasks.forEach((t) => m.get(t.status)?.push(t));
    return m;
  }, [tasks]);

  return (
    <div className="flex flex-1 gap-2 overflow-x-auto pb-2 sm:gap-3">
      {STATUS_COLUMNS.map((col) => {
        const items = grouped.get(col.id) ?? [];
        const isOver = overCol === col.id;
        return (
          <div
            key={col.id}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }}
            onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setOverCol(null);
              const id = e.dataTransfer.getData("text/task-id");
              const t = tasks.find((x) => x.id === id);
              if (t && t.status !== col.id) onMove(t, col.id);
            }}
            className={cn(
              "flex w-[260px] shrink-0 flex-col rounded-xl border bg-muted/30 transition-colors sm:w-[280px] md:w-[300px] lg:w-[320px]",
              isOver && "border-primary bg-primary/5",
            )}
          >
            <header className="flex items-center gap-2 border-b bg-background/60 px-2 py-2 sm:px-3">
              <span>{col.icon}</span>
              <h3 className="text-xs font-semibold sm:text-sm">{col.label}</h3>
              <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-1.5 sm:p-2">
              {items.map((t) => (
                <Card
                  key={t.id}
                  task={t}
                  dragging={dragId === t.id}
                  onDragStart={(e) => { e.dataTransfer.setData("text/task-id", t.id); setDragId(t.id); }}
                  onDragEnd={() => setDragId(null)}
                  onEdit={() => onEdit(t)}
                  onDelete={() => onDelete(t)}
                  onOpenEmail={() => t.source_email_id && onOpenEmail(t.source_email_id)}
                />
              ))}
              {items.length === 0 && (
                <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                  Déposez ici
                </div>
              )}
            </div>
            <button
              onClick={() => onCreate(col.id)}
              className="m-1.5 sm:m-2 flex items-center justify-center gap-1 rounded-md border border-dashed py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Nouvelle tâche
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Card({
  task, dragging, onDragStart, onDragEnd, onEdit, onDelete, onOpenEmail,
}: {
  task: Task;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenEmail: () => void;
}) {
  const overdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== "done";
  const section = getSection(task);
  const tagsClean = (task.tags ?? []).filter((t) => !t.startsWith("section:") && !t.startsWith("recurrence:"));
  const meta = PRIORITY_META[task.priority];
  const src = SOURCE_META[task.source_app];

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-grab rounded-md border bg-card p-2.5 text-sm shadow-sm transition-opacity hover:shadow-md active:cursor-grabbing",
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
                <button onClick={(e) => e.stopPropagation()} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" /> Éditer</DropdownMenuItem>
                {task.source_email_id && (
                  <DropdownMenuItem onClick={onOpenEmail}><Mail className="mr-2 h-3.5 w-3.5" /> Voir email source</DropdownMenuItem>
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
                ⏳ En attente de sync
              </Badge>
            )}
            {task.source_email_id && <Mail className="h-3 w-3 text-muted-foreground" />}
            {(task.tags ?? []).some((t) => t === "attachment") && <Paperclip className="h-3 w-3 text-muted-foreground" />}
          </div>

          {tagsClean.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tagsClean.slice(0, 4).map((t) => (
                <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">#{t}</span>
              ))}
            </div>
          )}

          {task.due_date && (
            <div className={cn(
              "mt-1.5 flex items-center gap-1 text-[11px]",
              overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}>
              <Clock className="h-3 w-3" />
              {new Date(task.due_date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
              {overdue && " — en retard"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
