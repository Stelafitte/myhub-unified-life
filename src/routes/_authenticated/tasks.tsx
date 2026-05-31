import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckSquare, LayoutGrid, GanttChart, List, Wifi, WifiOff, RefreshCw, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDeleteKey } from "@/hooks/use-delete-key";
import { KanbanView } from "@/components/tasks/kanban-view";
import { GanttView } from "@/components/tasks/gantt-view";
import { TaskListView } from "@/components/tasks/task-list-view";
import { TaskPanel } from "@/components/tasks/task-panel";
import { enqueue, flushQueue, installOnlineFlusher, listPending } from "@/lib/sync-queue";
import { cacheGetAll, cacheReplaceAll } from "@/lib/local-cache";
import { type Task, type TaskStatus, getSection, DEFAULT_SECTIONS } from "@/lib/tasks-model";
import { TaskRequestsPanel } from "@/components/tasks/task-requests";

export const Route = createFileRoute("/_authenticated/tasks")({
  validateSearch: (s: Record<string, unknown>) => ({
    newTitle: typeof s.newTitle === "string" ? s.newTitle : undefined,
    newDescription: typeof s.newDescription === "string" ? s.newDescription : undefined,
    newDue: typeof s.newDue === "string" ? s.newDue : undefined,
    newStart: typeof s.newStart === "string" ? s.newStart : undefined,
    newCalendarEventId: typeof s.newCalendarEventId === "string" ? s.newCalendarEventId : undefined,
  }),
  component: TasksPage,
});

type View = "kanban" | "gantt" | "list";

function TasksPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>(isMobile ? "list" : "kanban");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>("todo");
  const [draft, setDraft] = useState<{ title?: string; description?: string; due?: string; start?: string; calendarEventId?: string | null } | null>(null);

  // Auto-open create panel when arriving with prefill search params
  useEffect(() => {
    if (search.newTitle || search.newDescription || search.newCalendarEventId) {
      setDraft({
        title: search.newTitle,
        description: search.newDescription,
        due: search.newDue,
        start: search.newStart,
        calendarEventId: search.newCalendarEventId ?? null,
      });
      setEditing(null);
      setDefaultStatus("todo");
      setPanelOpen(true);
      // Clean URL so refresh doesn't reopen
      navigate({ to: "/tasks", search: {}, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const refreshPending = async () => {
    const ops = await listPending();
    setPendingCount(ops.length);
  };

  const load = async () => {
    // Hydrate from local cache first (offline-first)
    const cached = await cacheGetAll<Task>("tasks");
    if (cached.length) setTasks(cached);
    setLoading(true);
    if (navigator.onLine) {
      const { data, error } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
      if (error) {
        if (!cached.length) toast.error(error.message);
      } else {
        const list = (data ?? []) as Task[];
        setTasks(list);
        cacheReplaceAll("tasks", list).catch(() => {});
      }
    }
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

  const openCreate = (status: TaskStatus) => { setEditing(null); setDraft(null); setDefaultStatus(status); setPanelOpen(true); };
  const openEdit = (t: Task) => { setEditing(t); setDraft(null); setPanelOpen(true); };

  const forceSync = async () => {
    const res = await flushQueue();
    await load();
    toast.success(`Sync : ${res.ok} OK, ${res.failed} échec${res.failed > 1 ? "s" : ""}`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4 sm:gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary sm:h-11 sm:w-11">
          <CheckSquare className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">Tâches</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {tasks.length} tâche{tasks.length > 1 ? "s" : ""} · {sections.length || DEFAULT_SECTIONS.length} section{(sections.length || DEFAULT_SECTIONS.length) > 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Badge variant={online ? "secondary" : "destructive"} className="gap-1 text-xs">
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            <span className="hidden sm:inline">{online ? "En ligne" : "Hors-ligne"}</span>
          </Badge>
          {pendingCount > 0 && (
            <Button size="sm" variant="outline" onClick={forceSync} className="h-8 gap-1">
              <RefreshCw className="h-3 w-3" />
              <span className="hidden sm:inline">{pendingCount} en attente</span>
            </Button>
          )}

          <div className="inline-flex overflow-hidden rounded-md border">
            <button
              onClick={() => setView("list")}
              className={cn("flex items-center gap-1 px-2 py-1.5 text-xs transition-colors sm:gap-1.5 sm:px-3 sm:text-sm", view === "list" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">Liste</span>
            </button>
            <button
              onClick={() => setView("kanban")}
              className={cn("flex items-center gap-1 border-l px-2 py-1.5 text-xs transition-colors sm:gap-1.5 sm:px-3 sm:text-sm", view === "kanban" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden sm:inline">Kanban</span>
            </button>
            <button
              onClick={() => setView("gantt")}
              className={cn("flex items-center gap-1 border-l px-2 py-1.5 text-xs transition-colors sm:gap-1.5 sm:px-3 sm:text-sm", view === "gantt" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              <GanttChart className="h-4 w-4" />
              <span className="hidden sm:inline">Gantt</span>
            </button>
          </div>
          <Button onClick={() => openCreate("todo")} className="h-8 gap-1 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nouvelle tâche</span>
          </Button>
        </div>
      </div>

      {user && <TaskRequestsPanel userId={user.id} onCreated={load} />}

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
      ) : view === "list" ? (
        <TaskListView
          tasks={tasks}
          onMove={moveTask}
          onEdit={openEdit}
          onDelete={removeTask}
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
        draft={draft}
      />
    </div>
  );
}
