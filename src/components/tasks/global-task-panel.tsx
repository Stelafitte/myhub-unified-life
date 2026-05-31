import { TaskPanel } from "@/components/tasks/task-panel";
import { useTaskPanel } from "@/lib/task-panel-context";
import { toast } from "sonner";
import { type Task } from "@/lib/tasks-model";

export function GlobalTaskPanel() {
  const { open, task, draft, close } = useTaskPanel();

  const handleSaved = (saved: Task) => {
    // Global panel: just toast. Pages using their own TaskPanel handle local state.
    toast.success(task ? "Tâche mise à jour" : "Tâche créée");
  };

  return (
    <TaskPanel
      open={open}
      onOpenChange={(v) => { if (!v) close(); }}
      task={task}
      defaultStatus="todo"
      sections={[]}
      onSaved={handleSaved}
      draft={draft}
    />
  );
}
