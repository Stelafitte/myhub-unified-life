import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, CheckCircle2, AlertTriangle, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type TaskRow = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done" | "blocked";
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  assigned_to: string | null;
  comments: string | null;
};

export function AgendaItemActions({
  meetingId,
  meetingTitle,
  itemId,
  itemTitle,
  defaultAssignee,
  userId,
  onCountChange,
}: {
  meetingId: string;
  meetingTitle: string;
  itemId: string;
  itemTitle: string;
  defaultAssignee: string | null;
  userId: string;
  onCountChange?: (counts: { total: number; done: number; overdue: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState(defaultAssignee ?? "");
  const [newDue, setNewDue] = useState("");
  const tag = `agenda:${itemId}`;

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("tasks")
      .select("id,title,status,priority,due_date,assigned_to,comments,tags")
      .contains("tags", [tag])
      .order("created_at", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error("Impossible de charger les actions");
      return;
    }
    const rows = (data ?? []) as TaskRow[];
    setTasks(rows);
    emitCounts(rows);
  }

  function emitCounts(rows: TaskRow[]) {
    const now = Date.now();
    const total = rows.length;
    const done = rows.filter((t) => t.status === "done").length;
    const overdue = rows.filter(
      (t) => t.status !== "done" && t.due_date && new Date(t.due_date).getTime() < now,
    ).length;
    onCountChange?.({ total, done, overdue });
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`agenda-actions-${itemId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  async function addAction() {
    const title = newTitle.trim();
    if (!title) {
      toast.error("Titre requis");
      return;
    }
    const comments = `📋 ${meetingTitle} — ${itemTitle}`;
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        title,
        status: "todo",
        priority: "medium",
        source_app: "myhubpro",
        assigned_to: newAssignee.trim() || null,
        due_date: newDue ? new Date(newDue).toISOString() : null,
        comments,
        tags: [tag, "meeting-action"],
      })
      .select("id")
      .single();
    if (error || !data) {
      toast.error("Création impossible");
      return;
    }
    await supabase.from("meeting_tasks").insert({
      user_id: userId,
      meeting_id: meetingId,
      task_id: data.id,
    });
    setNewTitle("");
    setNewDue("");
    toast.success("Action créée");
    load();
  }

  async function toggleDone(t: TaskRow) {
    const next = t.status === "done" ? "todo" : "done";
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    const { error } = await supabase.from("tasks").update({ status: next }).eq("id", t.id);
    if (error) toast.error("Mise à jour impossible");
  }

  async function remove(t: TaskRow) {
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
    await supabase.from("meeting_tasks").delete().eq("task_id", t.id);
    const { error } = await supabase.from("tasks").delete().eq("id", t.id);
    if (error) toast.error("Suppression impossible");
  }

  const now = Date.now();
  const overdueCount = tasks.filter(
    (t) => t.status !== "done" && t.due_date && new Date(t.due_date).getTime() < now,
  ).length;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="pt-2 border-t mt-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ListPlus className="h-3 w-3" />
          Actions ({doneCount}/{tasks.length})
        </button>
        {overdueCount > 0 && (
          <Badge variant="destructive" className="text-[10px] gap-1">
            <AlertTriangle className="h-3 w-3" /> {overdueCount} en retard
          </Badge>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {loading ? (
            <p className="text-[10px] text-muted-foreground">Chargement…</p>
          ) : tasks.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">Aucune action.</p>
          ) : (
            <ul className="space-y-1">
              {tasks.map((t) => {
                const overdue =
                  t.status !== "done" && t.due_date && new Date(t.due_date).getTime() < now;
                return (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 rounded-md bg-background border px-2 py-1 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => toggleDone(t)}
                      className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                        t.status === "done"
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {t.status === "done" && <CheckCircle2 className="h-3 w-3" />}
                    </button>
                    <span
                      className={cn(
                        "flex-1 truncate",
                        t.status === "done" && "line-through text-muted-foreground",
                      )}
                    >
                      {t.title}
                    </span>
                    {t.assigned_to && (
                      <Badge variant="outline" className="text-[10px]">
                        {t.assigned_to}
                      </Badge>
                    )}
                    {t.due_date && (
                      <Badge
                        variant={overdue ? "destructive" : "secondary"}
                        className="text-[10px]"
                      >
                        {new Date(t.due_date).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </Badge>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(t)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_140px_auto] gap-2 items-end">
            <div>
              <Label className="text-[10px] text-muted-foreground">Nouvelle action</Label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ex: Préparer le rapport"
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAction();
                  }
                }}
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Assigné à</Label>
              <Input
                value={newAssignee}
                onChange={(e) => setNewAssignee(e.target.value)}
                placeholder="email ou nom"
                className="h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Échéance</Label>
              <Input
                type="date"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <Button type="button" size="sm" onClick={addAction} className="h-8">
              <Plus className="h-3 w-3 mr-1" /> Ajouter
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
