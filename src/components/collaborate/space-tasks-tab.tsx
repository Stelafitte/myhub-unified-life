import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Link2, Smartphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KanbanView } from "@/components/tasks/kanban-view";
import { TaskPanel } from "@/components/tasks/task-panel";
import { LinkPickerDialog } from "./link-picker-dialog";
import { listSpaceTasks, linkEntityToSpace, unlinkEntity } from "@/lib/collab.functions";
import { DEFAULT_SECTIONS, type Task, type TaskStatus } from "@/lib/tasks-model";
import { confirmDialog } from "@/lib/confirm-dialog";

interface Props {
  spaceId: string;
}

export function SpaceTasksTab({ spaceId }: Props) {
  const listFn = useServerFn(listSpaceTasks);
  const linkFn = useServerFn(linkEntityToSpace);
  const unlinkFn = useServerFn(unlinkEntity);
  const qc = useQueryClient();
  const queryKey = ["space-tasks", spaceId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { spaceId } }),
  });

  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const tasks = (data?.tasks ?? []) as Task[];
  const linkByTaskId = data?.linkByTaskId ?? {};

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey }),
      qc.invalidateQueries({ queryKey: ["space-links", spaceId] }),
    ]);

  const move = async (task: Task, status: TaskStatus) => {
    const { error } = await supabase
      .from("tasks")
      .update({ status, kanban_column: status })
      .eq("id", task.id);
    if (error) toast.error(error.message);
    else refresh();
  };

  const remove = async (task: Task) => {
    if (!(await confirmDialog(`Délier "${task.title}" de cet espace ?`))) return;
    const linkId = linkByTaskId[task.id];
    if (!linkId) return;
    try {
      await unlinkFn({ data: { linkId } });
      toast.success("Tâche déliée");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const onSaved = async (t: Task) => {
    setPanelOpen(false);
    if (!editing && t?.id) {
      try {
        await linkFn({ data: { spaceId, entityType: "task", entityId: t.id } });
        toast.success("Tâche créée et liée");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erreur de liaison");
      }
    }
    refresh();
  };

  // Augment tasks for badges via tags (kanban-view affiche les tags)
  const augmented = tasks.map((t) => {
    const isWa = t.source_app === "whatsapp";
    const isAi = (t.tags ?? []).some((x) => x === "ai" || x === "ai-suggested") || !!t.source_email_id;
    const extras: string[] = [];
    if (isWa) extras.push("📱 WA");
    if (isAi) extras.push("✨ IA");
    return { ...t, tags: [...(t.tags ?? []), ...extras] };
  });

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Tâches de l'espace</h2>
          <Badge variant="secondary">{tasks.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <Link2 className="h-3.5 w-3.5 mr-1" /> Lier une tâche existante
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setPanelOpen(true); }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Nouvelle tâche
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border rounded-md">
          Aucune tâche liée à cet espace.
        </div>
      ) : (
        <KanbanView
          tasks={augmented}
          onMove={move}
          onEdit={(t) => { setEditing(t); setPanelOpen(true); }}
          onDelete={remove}
          onCreate={() => { setEditing(null); setPanelOpen(true); }}
          onOpenEmail={() => {}}
        />
      )}

      <TaskPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        task={editing}
        sections={[...DEFAULT_SECTIONS]}
        onSaved={onSaved}
      />

      <LinkPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        spaceId={spaceId}
        restrictTypes={["task"]}
      />
    </div>
  );
}
