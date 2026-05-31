import { createContext, useContext, useState, useCallback } from "react";
import { type Task } from "@/lib/tasks-model";

type Draft = {
  title?: string;
  description?: string;
  due?: string;
  start?: string;
  calendarEventId?: string | null;
};

type TaskPanelCtx = {
  open: boolean;
  task: Task | null;
  draft: Draft | null;
  openCreate: (draft?: Draft) => void;
  openEdit: (task: Task) => void;
  close: () => void;
};

const TaskPanelContext = createContext<TaskPanelCtx | null>(null);

export function TaskPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const openCreate = useCallback((d?: Draft) => {
    setTask(null);
    setDraft(d ?? null);
    setOpen(true);
  }, []);

  const openEdit = useCallback((t: Task) => {
    setTask(t);
    setDraft(null);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setTask(null);
    setDraft(null);
  }, []);

  return (
    <TaskPanelContext.Provider value={{ open, task, draft, openCreate, openEdit, close }}>
      {children}
    </TaskPanelContext.Provider>
  );
}

export function useTaskPanel() {
  const ctx = useContext(TaskPanelContext);
  if (!ctx) throw new Error("useTaskPanel must be used within TaskPanelProvider");
  return ctx;
}
