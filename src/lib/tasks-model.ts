import type { Database } from "@/integrations/supabase/types";

export type TaskAttachment = { name: string; size?: number | null; mime?: string | null; url?: string | null };

export type Task = Database["public"]["Tables"]["tasks"]["Row"] & {
  _pending?: boolean;
};

export type TaskStatus = Database["public"]["Enums"]["task_status"];
export type TaskPriority = Database["public"]["Enums"]["task_priority"];
export type TaskSource = Database["public"]["Enums"]["task_source"];

export const STATUS_COLUMNS: { id: TaskStatus; label: string; icon: string }[] = [
  { id: "todo", label: "À faire", icon: "📥" },
  { id: "in_progress", label: "En cours", icon: "⚙️" },
  { id: "done", label: "Terminé", icon: "✅" },
  { id: "archived", label: "Archivé", icon: "📦" },
];

export const PRIORITY_META: Record<TaskPriority, { label: string; dot: string; bar: string; emoji: string }> = {
  urgent: { label: "Urgent", dot: "bg-red-500", bar: "bg-red-500", emoji: "🔴" },
  high: { label: "Haute", dot: "bg-orange-500", bar: "bg-orange-500", emoji: "🟠" },
  medium: { label: "Moyenne", dot: "bg-amber-400", bar: "bg-amber-400", emoji: "🟡" },
  low: { label: "Basse", dot: "bg-emerald-500", bar: "bg-emerald-500", emoji: "🟢" },
};

export const SOURCE_META: Record<TaskSource, { label: string; emoji: string }> = {
  myhubpro: { label: "Manuel", emoji: "✍️" },
  microsoft_todo: { label: "MS To Do", emoji: "☑️" },
  apple_reminders: { label: "Rappels", emoji: "🍎" },
  whatsapp: { label: "WhatsApp", emoji: "📱" },
};

export const DEFAULT_SECTIONS = ["CHU", "Université", "Personnel", "Autre"] as const;

export function getSection(task: Task): string {
  const sec = (task.tags ?? []).find((t) => t.startsWith("section:"));
  return sec ? sec.slice(8) : "Autre";
}

export function withoutSection(tags: string[] | null): string[] {
  return (tags ?? []).filter((t) => !t.startsWith("section:"));
}
