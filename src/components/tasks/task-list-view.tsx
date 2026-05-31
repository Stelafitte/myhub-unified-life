import { useMemo } from "react";
import { Pencil, Trash2, Mail, Clock, CheckCircle2, Circle, PlayCircle, Archive, MoreHorizontal, ArrowRight, Check } from "lucide-react";
import { SwipeableRow, type SwipeAction } from "@/components/inbox/swipeable-row";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
  onOpenEmail?: (emailId: string) => void;
};

const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  todo: <Circle className="h-4 w-4 text-muted-foreground" />,
  in_progress: <PlayCircle className="h-4 w-4 text-blue-500" />,
  done: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  archived: <Archive className="h-4 w-4 text-slate-400" />,
};

export function TaskListView({ tasks, onEdit, onDelete, onMove, onOpenEmail }: Props) {
  const sorted = useMemo(() => {
    const order: TaskStatus[] = ["todo", "in_progress", "done", "archived"];
    return [...tasks].sort((a, b) => {
      const ao = order.indexOf(a.status);
      const bo = order.indexOf(b.status);
      if (ao !== bo) return ao - bo;
      // Then by due date (soonest first)
      if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });
  }, [tasks]);

  return (
    <div className="flex flex-col gap-2">
      {STATUS_COLUMNS.map((col) => {
        const colTasks = sorted.filter((t) => t.status === col.id);
        if (colTasks.length === 0) return null;
        return (
          <section key={col.id} className="rounded-xl border bg-muted/20">
            <header className="flex items-center gap-2 border-b bg-background/60 px-3 py-2">
              <span>{col.icon}</span>
              <h3 className="text-sm font-semibold">{col.label}</h3>
              <span className="ml-auto text-xs text-muted-foreground">{colTasks.length}</span>
            </header>
            <ul className="divide-y">
              {colTasks.map((task) => {
                const leftActions: SwipeAction[] = task.status !== "done" ? [{
                  key: "done",
                  label: "Terminé",
                  icon: <Check className="h-4 w-4" />,
                  color: "bg-emerald-500",
                  onAction: () => onMove(task, "done"),
                }] : [{
                  key: "todo",
                  label: "À faire",
                  icon: <Circle className="h-4 w-4" />,
                  color: "bg-slate-500",
                  onAction: () => onMove(task, "todo"),
                }];
                const rightActions: SwipeAction[] = [
                  ...(task.status !== "archived" ? [{
                    key: "archive",
                    label: "Archiver",
                    icon: <Archive className="h-4 w-4" />,
                    color: "bg-slate-500",
                    onAction: () => onMove(task, "archived"),
                  }] : []),
                  {
                    key: "delete",
                    label: "Suppr.",
                    icon: <Trash2 className="h-4 w-4" />,
                    color: "bg-destructive",
                    onAction: () => onDelete(task),
                  },
                ];
                return (
                  <li key={task.id}>
                    <SwipeableRow leftActions={leftActions} rightActions={rightActions}>
                      <TaskRow
                        task={task}
                        onEdit={() => onEdit(task)}
                        onDelete={() => onDelete(task)}
                        onStatusChange={(status) => onMove(task, status)}
                        onOpenEmail={() => task.source_email_id && onOpenEmail?.(task.source_email_id)}
                      />
                    </SwipeableRow>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {sorted.length === 0 && (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          Aucune tâche
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  onEdit,
  onDelete,
  onStatusChange,
  onOpenEmail,
}: {
  task: Task;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onOpenEmail: () => void;
}) {
  const overdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== "done";
  const section = getSection(task);
  const meta = PRIORITY_META[task.priority];
  const src = SOURCE_META[task.source_app];
  const tagsClean = (task.tags ?? []).filter((t) => !t.startsWith("section:") && !t.startsWith("recurrence:"));

  return (
    <div
      onClick={onEdit}
      className="flex items-start gap-3 bg-background px-3 py-3 cursor-pointer hover:bg-accent/30 active:bg-accent/50"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          const next: TaskStatus = task.status === "done" ? "todo" : "done";
          onStatusChange(next);
        }}
        className="mt-0.5 shrink-0"
        aria-label={task.status === "done" ? "Marquer comme à faire" : "Marquer comme terminée"}
      >
        {STATUS_ICON[task.status]}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h4
            className={cn(
              "flex-1 text-sm font-medium leading-snug",
              task.status === "done" && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </h4>
        </div>

        {task.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
          {task.due_date && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px]",
                overdue ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              <Clock className="h-3 w-3" />
              {new Date(task.due_date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
              {overdue && " retard"}
            </span>
          )}
        </div>

        {tagsClean.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tagsClean.slice(0, 3).map((t) => (
              <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" /> Éditer</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground">Déplacer vers</DropdownMenuLabel>
            {STATUS_COLUMNS.filter((c) => c.id !== task.status).map((c) => (
              <DropdownMenuItem key={c.id} onClick={() => onStatusChange(c.id)}>
                <ArrowRight className="mr-2 h-3.5 w-3.5" /> {c.icon} {c.label}
              </DropdownMenuItem>
            ))}
            {task.source_email_id && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onOpenEmail}><Mail className="mr-2 h-3.5 w-3.5" /> Voir email source</DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
