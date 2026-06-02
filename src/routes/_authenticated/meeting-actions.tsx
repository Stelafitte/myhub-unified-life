import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CalendarClock, AlertTriangle, ExternalLink, Loader2, CheckCircle2, Circle, Timer } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/meeting-actions")({
  component: MeetingActionsPage,
});

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "done" | "archived";
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  assigned_to: string | null;
  user_id: string;
};

type Meeting = { id: string; title: string; start_at: string };
type MTLink = { meeting_id: string; task_id: string };

const STATUS_COLS: { key: Task["status"]; label: string; icon: typeof Circle; tone: string }[] = [
  { key: "todo", label: "À faire", icon: Circle, tone: "text-muted-foreground" },
  { key: "in_progress", label: "En cours", icon: Timer, tone: "text-primary" },
  { key: "done", label: "Terminé", icon: CheckCircle2, tone: "text-emerald-500" },
];

function MeetingActionsPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [meetingFilter, setMeetingFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [linkRes, meetRes] = await Promise.all([
      supabase.from("meeting_tasks").select("meeting_id, task_id"),
      supabase.from("meetings").select("id, title, start_at").order("start_at", { ascending: false }),
    ]);
    const linkRows = (linkRes.data ?? []) as Link[];
    setLinks(linkRows);
    setMeetings((meetRes.data ?? []) as Meeting[]);
    const taskIds = Array.from(new Set(linkRows.map((l) => l.task_id)));
    if (taskIds.length) {
      const { data } = await supabase
        .from("tasks")
        .select("id, title, description, status, priority, due_date, assigned_to, user_id")
        .in("id", taskIds);
      setTasks((data ?? []) as Task[]);
    } else {
      setTasks([]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const taskMeetingMap = useMemo(() => {
    const map: Record<string, string> = {};
    links.forEach((l) => { map[l.task_id] = l.meeting_id; });
    return map;
  }, [links]);

  const meetingMap = useMemo(() => {
    const m: Record<string, Meeting> = {};
    meetings.forEach((x) => { m[x.id] = x; });
    return m;
  }, [meetings]);

  const assignees = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => { if (t.assigned_to) set.add(t.assigned_to); });
    return Array.from(set).sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (meetingFilter !== "all" && taskMeetingMap[t.id] !== meetingFilter) return false;
      if (assigneeFilter !== "all" && (t.assigned_to ?? "") !== assigneeFilter) return false;
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (showOverdueOnly) {
        if (!t.due_date || t.status === "done") return false;
        if (!isPast(new Date(t.due_date))) return false;
      }
      return true;
    });
  }, [tasks, meetingFilter, assigneeFilter, search, showOverdueOnly, taskMeetingMap]);

  const byStatus = useMemo(() => {
    const groups: Record<Task["status"], Task[]> = { todo: [], in_progress: [], done: [], archived: [] };
    filtered.forEach((t) => { (groups[t.status] ??= []).push(t); });
    return groups;
  }, [filtered]);

  const overdueCount = useMemo(() => tasks.filter((t) => t.due_date && t.status !== "done" && isPast(new Date(t.due_date))).length, [tasks]);

  const setStatus = async (taskId: string, status: Task["status"]) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
    if (error) {
      toast.error("Mise à jour impossible");
      load();
    }
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Actions de réunion</h1>
          <p className="text-sm text-muted-foreground">
            {tasks.length} action{tasks.length > 1 ? "s" : ""} issues de vos réunions
            {overdueCount > 0 && <> · <span className="text-destructive font-medium">{overdueCount} en retard</span></>}
          </p>
        </div>
        <Button variant={showOverdueOnly ? "default" : "outline"} size="sm" onClick={() => setShowOverdueOnly((v) => !v)}>
          <AlertTriangle className="h-4 w-4 mr-1" /> En retard {overdueCount > 0 && `(${overdueCount})`}
        </Button>
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <Input placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs h-9" />
        <Select value={meetingFilter} onValueChange={setMeetingFilter}>
          <SelectTrigger className="w-[220px] h-9"><SelectValue placeholder="Toutes les réunions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les réunions</SelectItem>
            {meetings.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Tous les responsables" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les responsables</SelectItem>
            {assignees.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Chargement…</div>
      ) : (
        <Tabs defaultValue="kanban">
          <TabsList>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
            <TabsTrigger value="list">Liste</TabsTrigger>
          </TabsList>

          <TabsContent value="kanban" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {STATUS_COLS.map((col) => {
                const Icon = col.icon;
                const items = byStatus[col.key];
                return (
                  <div key={col.key} className="space-y-2">
                    <div className="flex items-center gap-2 px-1">
                      <Icon className={cn("h-4 w-4", col.tone)} />
                      <h3 className="text-sm font-semibold">{col.label}</h3>
                      <Badge variant="secondary" className="ml-auto">{items.length}</Badge>
                    </div>
                    <div className="space-y-2 min-h-[100px]">
                      {items.map((t) => (
                        <TaskCard key={t.id} task={t} meeting={meetingMap[taskMeetingMap[t.id]]} onStatusChange={setStatus} />
                      ))}
                      {items.length === 0 && (
                        <Card className="p-4 text-xs text-muted-foreground text-center border-dashed">Aucune action</Card>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="list" className="mt-4 space-y-2">
            {filtered.length === 0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">Aucune action ne correspond aux filtres.</Card>
            )}
            {filtered.map((t) => (
              <TaskCard key={t.id} task={t} meeting={meetingMap[taskMeetingMap[t.id]]} onStatusChange={setStatus} compact />
            ))}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function TaskCard({ task, meeting, onStatusChange, compact }: {
  task: Task; meeting?: Meeting; onStatusChange: (id: string, status: Task["status"]) => void; compact?: boolean;
}) {
  const overdue = task.due_date && task.status !== "done" && isPast(new Date(task.due_date));
  const dueToday = task.due_date && isToday(new Date(task.due_date));
  const priorityTone = task.priority === "urgent" ? "destructive" : task.priority === "high" ? "default" : "secondary";

  return (
    <Card className={cn("p-3 space-y-2", compact && "flex items-start gap-3")}>
      <div className="flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{task.title}</p>
          <Badge variant={priorityTone as never} className="shrink-0 text-[10px] uppercase">{task.priority}</Badge>
        </div>
        {meeting && (
          <Link to="/meetings" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
            <CalendarClock className="h-3 w-3" />
            <span className="truncate">{meeting.title}</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {task.due_date && (
            <span className={cn("flex items-center gap-1", overdue && "text-destructive font-medium", dueToday && !overdue && "text-amber-500")}>
              <CalendarClock className="h-3 w-3" />
              {format(new Date(task.due_date), "dd MMM", { locale: fr })}
            </span>
          )}
          {task.assigned_to && <Badge variant="outline" className="text-[10px]">{task.assigned_to}</Badge>}
        </div>
      </div>
      <div className="flex gap-1 pt-1">
        {STATUS_COLS.map((c) => (
          <Button
            key={c.key}
            size="sm"
            variant={task.status === c.key ? "default" : "outline"}
            className="h-7 px-2 text-[11px]"
            onClick={() => onStatusChange(task.id, c.key)}
          >
            {c.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
