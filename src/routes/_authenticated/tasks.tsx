import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckSquare, LayoutGrid, GanttChart, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KanbanView } from "@/components/tasks/kanban-view";
import { GanttView } from "@/components/tasks/gantt-view";
import { TaskPanel } from "@/components/tasks/task-panel";
import { enqueue, flushQueue, installOnlineFlusher, listPending } from "@/lib/sync-queue";
import { type Task, type TaskStatus, getSection, DEFAULT_SECTIONS } from "@/lib/tasks-model";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: TasksPage,
});

type View = "kanban" | "gantt";

function TasksPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("kanban");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>("todo");

  const refreshPending = async () => {
    const ops = await listPending();
    setPendingCount(ops.length);
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setTasks((data ?? []) as Task[]);
    setLoading(false);
    await refreshPending();
  };

  useEffect(() => { if (user) load(); }, [user]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const dispose = installOnlineFlusher(() => { load(); });
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      dispose();
    };
  }, []);

  const sections = useMemo(() => Array.from(new Set(tasks.map(getSection))), [tasks]);

  const handleSaved = (saved: Task) => {
    setTasks((prev) => {
      const i = prev.findIndex((t) => t.id === saved.id);
      if (i >= 0) { const next = [...prev]; next[i] = saved; return next; }
      return [saved, ...prev];
    });
    refreshPending();
  };

  const moveTask = async (task: Task, status: TaskStatus) => {
    const updated = { ...task, status, kanban_column: status };
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    if (navigator.onLine) {
      const { error } = await supabase.from("tasks").update({ status, kanban_column: status }).eq("id", task.id);
      if (error) toast.error(error.message);
    } else {
      await enqueue({ entity_type: "task", entity_id: task.id, action: "update", payload: { status, kanban_column: status } });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...updated, _pending: true } : t)));
      refreshPending();
      toast.message("Déplacement mis en file (offline)");
    }
  };

  const updateRange = async (task: Task, start: Date, end: Date) => {
    const payload = { gantt_start: start.toISOString(), gantt_end: end.toISOString(), due_date: end.toISOString() };
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...payload } : t)));
    if (navigator.onLine) {
      const { error } = await supabase.from("tasks").update(payload).eq("id", task.id);
      if (error) toast.error(error.message);
    } else {
      await enqueue({ entity_type: "task", entity_id: task.id, action: "update", payload });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...payload, _pending: true } : t)));
      refreshPending();
    }
  };

  const removeTask = async (task: Task) => {
    if (!confirm(`Supprimer "${task.title}" ?`)) return;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    if (navigator.onLine) {
      const { error } = await supabase.from("tasks").delete().eq("id", task.id);
      if (error) toast.error(error.message);
      else toast.success("Tâche supprimée");
    } else {
      await enqueue({ entity_type: "task", entity_id: task.id, action: "delete" });
      refreshPending();
      toast.message("Suppression mise en file (offline)");
    }
  };

  const openCreate = (status: TaskStatus) => { setEditing(null); setDefaultStatus(status); setPanelOpen(true); };
  const openEdit = (t: Task) => { setEditing(t); setPanelOpen(true); };

  const forceSync = async () => {
    const res = await flushQueue();
    await load();
    toast.success(`Sync : ${res.ok} OK, ${res.failed} échec${res.failed > 1 ? "s" : ""}`);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CheckSquare className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tâches</h1>
          <p className="text-sm text-muted-foreground">
            {tasks.length} tâche{tasks.length > 1 ? "s" : ""} · {sections.length || DEFAULT_SECTIONS.length} section{(sections.length || DEFAULT_SECTIONS.length) > 1 ? "s" : ""}
          </p>
        </div>

        <Badge variant={online ? "secondary" : "destructive"} className="gap-1">
          {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {online ? "En ligne" : "Hors-ligne"}
        </Badge>
        {pendingCount > 0 && (
          <Button size="sm" variant="outline" onClick={forceSync} className="h-8 gap-1">
            <RefreshCw className="h-3 w-3" />
            {pendingCount} en attente
          </Button>
        )}

        <div className="ml-auto inline-flex overflow-hidden rounded-md border">
          <button
            onClick={() => setView("kanban")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors", view === "kanban" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            <LayoutGrid className="h-4 w-4" /> Kanban
          </button>
          <button
            onClick={() => setView("gantt")}
            className={cn("flex items-center gap-1.5 border-l px-3 py-1.5 text-sm transition-colors", view === "gantt" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            <GanttChart className="h-4 w-4" /> Gantt
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border bg-muted/30 p-12 text-center text-sm text-muted-foreground">Chargement…</div>
      ) : view === "kanban" ? (
        <KanbanView
          tasks={tasks}
          onMove={moveTask}
          onEdit={openEdit}
          onDelete={removeTask}
          onCreate={openCreate}
          onOpenEmail={() => navigate({ to: "/inbox" })}
        />
      ) : (
        <GanttView tasks={tasks} onEdit={openEdit} onUpdateRange={updateRange} />
      )}

      <TaskPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        task={editing}
        defaultStatus={defaultStatus}
        sections={sections}
        onSaved={handleSaved}
      />
    </div>
  );
}
